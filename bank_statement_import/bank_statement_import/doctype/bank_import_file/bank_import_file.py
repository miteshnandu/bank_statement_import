# Copyright (c) 2025, Nandu Custom and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt, getdate, get_datetime, nowdate, cstr
import pandas as pd
import json
import re
import os
from datetime import datetime


class BankImportFile(Document):
	"""Main doctype for bank statement import"""
	
	def validate(self):
		"""Calculate statistics before save"""
		self.update_statistics()
	
	def update_statistics(self):
		"""Update row count statistics"""
		self.total_rows = len(self.bank_import_rows)
		self.applied_rows = len([r for r in self.bank_import_rows if r.status == "Applied"])
		self.failed_rows = len([r for r in self.bank_import_rows if r.status == "Failed"])
		self.ignored_rows = len([r for r in self.bank_import_rows if r.status == "Ignored"])


@frappe.whitelist()
def parse_preview(file_url, bank_account, company, mapping_template=None):
	"""
	Parse uploaded Excel file and return preview data with suggested mappings
	
	Args:
		file_url: Frappe file URL or absolute file path
		bank_account: Link to Account doctype
		company: Company name
		mapping_template: Optional Bank Import Mapping name
		
	Returns:
		dict with preview_data, suggested_mapping, error
	"""
	try:
		# Get file path - handle both public and private files
		if file_url.startswith("/files/"):
			file_path = frappe.get_site_path("public", file_url.lstrip("/"))
		elif file_url.startswith("/private/files/"):
			file_path = frappe.get_site_path(file_url.lstrip("/"))
		else:
			file_path = file_url
		
		if not os.path.exists(file_path):
			frappe.throw(f"File not found: {file_path}")
		
		# Parse the bank statement
		rows = parse_bank_sheet(file_path)
		
		if not rows:
			frappe.throw("No valid rows found in the uploaded file")
		
		# Get suggested column mapping
		df = pd.read_excel(file_path)
		suggested_mapping = suggest_column_mapping(df)
		
		# Load mapping rules if template provided
		mappings = []
		if mapping_template:
			mappings = frappe.get_all(
				"Bank Import Mapping",
				filters={"enabled": 1},
				fields=["*"],
				order_by="priority ASC"
			)
		
		# Apply mapping suggestions to rows
		for row in rows[:200]:  # Limit preview to 200 rows
			# Default action based on transaction type
			if not row.get("suggested_action"):
				# Default to Payment Entry for most transactions
				row["suggested_action"] = "Payment Entry"
			
			# Suggest action based on mapping rules
			if mappings:
				from bank_statement_import.bank_statement_import.doctype.bank_import_mapping.bank_import_mapping import BankImportMapping
				matched_mapping = BankImportMapping.match_row(row, mappings)
				if matched_mapping:
					target_type = matched_mapping.get("target_type")
					if target_type in ["Payment Entry", "Journal Entry"]:
						row["suggested_action"] = target_type
					row["matched_mapping"] = matched_mapping.get("name")
			
			# Auto-detect ATM/Cash withdrawals
			narration_lower = str(row.get("narration", "")).lower()
			if any(keyword in narration_lower for keyword in ["atm", "cash withdrawal", "withdrawal", "cash wdrl"]):
				row["suggested_action"] = "Internal Transfer"
		
		# Create Bank Import File document
		import_doc = frappe.new_doc("Bank Import File")
		import_doc.company = company
		import_doc.bank_account = bank_account
		import_doc.file = file_url
		import_doc.upload_date = nowdate()
		
		# Add rows
		for row in rows:
			import_doc.append("bank_import_rows", {
				"row_no": row.get("row_no"),
				"posting_date": row.get("posting_date"),
				"value_date": row.get("value_date"),
				"dr_cr_flag": row.get("dr_cr_flag"),
				"amount": row.get("amount"),
				"narration": row.get("narration"),
				"party_name": row.get("party_name"),
				"cheque_no": row.get("cheque_no"),
				"reference": row.get("reference"),
				"suggested_action": row.get("suggested_action", "Payment Entry"),
				"status": "Pending"
			})
		
		import_doc.insert()
		frappe.db.commit()
		
		return {
			"success": True,
			"preview_data": rows[:200],
			"suggested_mapping": suggested_mapping,
			"total_rows": len(rows),
			"bank_account": bank_account,
			"company": company,
			"import_doc_name": import_doc.name
		}
		
	except Exception as e:
		frappe.log_error(message=str(e), title="Bank Import Parse Error")
		return {
			"success": False,
			"error": str(e)
		}


def parse_bank_sheet(file_path, sheet=0):
	"""
	Parse bank statement Excel file
	
	Args:
		file_path: Absolute path to Excel file
		sheet: Sheet index or name
		
	Returns:
		List of dicts with normalized row data
	"""
	try:
		# Read Excel file - first pass to detect header
		df = pd.read_excel(file_path, sheet_name=sheet, header=None)
		
		# Detect header row - look for common keywords
		header_keywords = ["transaction", "date", "narration", "amount", "ref", "cheque", "particulars", "description", "sl"]
		header_row_idx = 0
		
		for idx, row in df.iterrows():
			row_str = " ".join([str(cell).lower() for cell in row if pd.notna(cell)])
			if any(keyword in row_str for keyword in header_keywords):
				header_row_idx = idx
				break
		
		# Re-read with detected header
		df = pd.read_excel(file_path, sheet_name=sheet, header=header_row_idx)
		
		# Normalize column names
		df.columns = [normalize_column_name(col) for col in df.columns]
		
		# Remove empty rows
		df = df.dropna(how="all")
		
		# Remove rows where all values are strings (likely headers or totals)
		df = df[~df.apply(lambda row: all(isinstance(val, str) for val in row if pd.notna(val)), axis=1)]
		
		# Parse rows
		rows = []
		for idx, row_data in df.iterrows():
			parsed_row = parse_row(row_data, len(rows) + 1)
			if parsed_row:
				rows.append(parsed_row)
		
		return rows
		
	except Exception as e:
		frappe.log_error(message=str(e), title="Bank Sheet Parse Error")
		frappe.throw(f"Error parsing Excel file: {str(e)}")


def normalize_column_name(col_name):
	"""Convert column name to safe string, preserving meaning"""
	if pd.isna(col_name):
		return "unnamed"
	col_str = str(col_name).strip().lower()
	
	# Handle common abbreviations before removing special chars
	replacements = {
		"sl. no": "sl_no",
		"chq / ref": "chq_ref",
		"dr / cr": "dr_cr",
		"txn": "transaction"
	}
	
	for old, new in replacements.items():
		if old in col_str:
			col_str = col_str.replace(old, new)
	
	# Remove special characters except underscore
	col_str = re.sub(r'[^a-z0-9\s_]', '', col_str)
	# Replace multiple spaces with single underscore
	col_str = re.sub(r'\s+', '_', col_str)
	# Remove leading/trailing underscores
	col_str = col_str.strip('_')
	
	return col_str if col_str else "unnamed"


def parse_row(row_data, row_no):
	"""
	Parse individual row from DataFrame
	
	Returns dict with standardized fields or None if invalid
	"""
	try:
		row_dict = row_data.to_dict()
		
		# Find date columns - support multiple formats
		posting_date = find_date_value(row_dict, ["date", "posting_date", "transaction_date", "txn_date", "value_date", "trans_date"])
		value_date = find_date_value(row_dict, ["value_date", "val_date", "valuedate"])
		
		# Find amount - check both amount column and separate dr/cr columns
		amount = find_numeric_value(row_dict, ["amount", "debit", "credit", "withdrawal", "deposit", "txn_amount", "transaction_amount"])
		
		# If amount is 0, try to get from debit or credit columns
		if not amount or amount == 0:
			debit_amt = find_numeric_value(row_dict, ["debit", "dr", "withdrawal"])
			credit_amt = find_numeric_value(row_dict, ["credit", "cr", "deposit"])
			amount = debit_amt or credit_amt or 0
		
		# Determine debit/credit flag
		dr_cr_flag = determine_dr_cr(row_dict)
		
		# Find narration/description
		narration = find_text_value(row_dict, ["narration", "description", "particulars", "remarks", "details", "transaction_remarks", "desc"])
		
		# Find party name
		party_name = find_text_value(row_dict, ["party", "party_name", "customer", "vendor", "beneficiary"])
		
		# Find cheque/reference no - support multiple column names
		cheque_no = find_text_value(row_dict, ["cheque", "cheque_no", "chq_no", "chq", "instrument_no", "cheque_number"])
		
		# Find reference - support multiple formats
		reference = find_text_value(row_dict, ["reference", "ref", "ref_no", "refno", "transaction_id", "txn_id", "utr", "utr_no"])
		
		# If no separate reference, use cheque_no as reference
		# If still no reference, use narration/particulars as reference (for IDFC and other banks)
		if not reference and cheque_no:
			reference = cheque_no
		if not reference and narration:
			reference = narration
		
		# Skip rows without essential data - but log why
		if not posting_date:
			return None
		
		if not amount or amount == 0:
			return None
		
		return {
			"row_no": row_no,
			"posting_date": posting_date,
			"value_date": value_date or posting_date,  # Use posting_date if value_date missing
			"narration": narration[:500] if narration else "",  # Limit length
			"amount": abs(amount),  # Store as positive
			"dr_cr_flag": dr_cr_flag,
			"party_name": party_name[:140] if party_name else "",
			"cheque_no": cheque_no[:100] if cheque_no else "",
			"reference": reference[:140] if reference else "",
			"raw_json": json.dumps(row_dict, default=str),
			"status": "Pending"
		}
		
	except Exception as e:
		frappe.log_error(message=f"Row {row_no} parse error: {str(e)}", title="Bank Row Parse Error")
		return None


def find_date_value(row_dict, possible_keys):
	"""Find date value from row dict by checking possible column names"""
	for key in possible_keys:
		for col_name, value in row_dict.items():
			if key in col_name.lower() and pd.notna(value):
				try:
					# Try to parse as date
					if isinstance(value, datetime):
						return value.date()
					
					# Handle string dates with time (e.g., "01/04/2025 07:34")
					value_str = str(value).strip()
					if ' ' in value_str:
						value_str = value_str.split(' ')[0]  # Take date part only
					
					return getdate(value_str)
				except Exception as e:
					frappe.log_error(f"Date parse error for {value}: {str(e)}", "Bank Import Date Parse")
					pass
	return None


def find_numeric_value(row_dict, possible_keys):
	"""Find numeric value from row dict"""
	for key in possible_keys:
		for col_name, value in row_dict.items():
			if key in col_name.lower() and pd.notna(value):
				try:
					return flt(value)
				except:
					pass
	return 0.0


def find_text_value(row_dict, possible_keys):
	"""Find text value from row dict"""
	for key in possible_keys:
		for col_name, value in row_dict.items():
			if key in col_name.lower() and pd.notna(value):
				return cstr(value).strip()
	return ""


def determine_dr_cr(row_dict):
	"""Determine if transaction is Debit or Credit"""
	# Check for explicit Dr/Cr column (case insensitive, handles spaces)
	for col_name, value in row_dict.items():
		col_lower = col_name.lower().replace(' ', '').replace('/', '').replace('_', '')
		# Check variations: "dr_cr", "drcr", "dr/cr", "type", "transaction_type"
		if any(pattern in col_lower for pattern in ["drcr", "drorcr", "type", "transactiontype", "debitcredit"]):
			if pd.notna(value):
				value_str = str(value).upper().strip()
				# Check for Credit first (more specific)
				if "CR" in value_str or "CREDIT" in value_str or value_str == "C":
					return "Cr"
				# Then check for Debit
				elif "DR" in value_str or "DEBIT" in value_str or value_str == "D":
					return "Dr"
	
	# Check if separate debit/credit columns exist
	debit_val = find_numeric_value(row_dict, ["debit", "withdrawal", "dr"])
	credit_val = find_numeric_value(row_dict, ["credit", "deposit", "cr"])
	
	# If both have values, it's an error in the file, but prefer the non-zero one
	if debit_val and debit_val > 0 and (not credit_val or credit_val == 0):
		return "Dr"
	elif credit_val and credit_val > 0 and (not debit_val or debit_val == 0):
		return "Cr"
	
	# Check balance columns if present - if transaction reduces balance, it's Dr
	# This is bank's perspective
	
	return "Dr"  # Default to debit


def suggest_column_mapping(df):
	"""
	Suggest column mapping based on column names
	
	Returns dict with field -> column_name mapping
	"""
	columns = [normalize_column_name(col) for col in df.columns]
	
	mapping = {
		"posting_date": None,
		"amount": None,
		"narration": None,
		"party_name": None,
		"cheque_no": None,
		"reference": None
	}
	
	# Map date
	date_keywords = ["date", "posting_date", "transaction_date", "txn_date"]
	for col in columns:
		if any(kw in col for kw in date_keywords):
			mapping["posting_date"] = col
			break
	
	# Map amount
	amount_keywords = ["amount", "debit", "credit", "withdrawal", "deposit"]
	for col in columns:
		if any(kw in col for kw in amount_keywords):
			mapping["amount"] = col
			break
	
	# Map narration
	narration_keywords = ["narration", "description", "particulars", "remarks"]
	for col in columns:
		if any(kw in col for kw in narration_keywords):
			mapping["narration"] = col
			break
	
	# Map party
	party_keywords = ["party", "customer", "vendor", "beneficiary"]
	for col in columns:
		if any(kw in col for kw in party_keywords):
			mapping["party_name"] = col
			break
	
	# Map cheque
	cheque_keywords = ["cheque", "chq", "instrument"]
	for col in columns:
		if any(kw in col for kw in cheque_keywords):
			mapping["cheque_no"] = col
			break
	
	# Map reference
	ref_keywords = ["reference", "ref", "utr", "transaction_id", "txn_id"]
	for col in columns:
		if any(kw in col for kw in ref_keywords):
			mapping["reference"] = col
			break
	
	return mapping


@frappe.whitelist()
def apply_import(import_doc_name, rows_json, mapping_json=None, series_config=None):
	"""
	Apply bank import - create Payment Entries and Journal Entries
	
	Args:
		import_doc_name: Name of Bank Import File doc
		rows_json: JSON string of rows to apply (list of row indices)
		mapping_json: Optional JSON string of additional mapping config
		series_config: Optional JSON string with payment_entry_series and journal_entry_series
		
	Returns:
		dict with success, summary, errors
	"""
	try:
		import_doc = frappe.get_doc("Bank Import File", import_doc_name)
		rows_to_apply = json.loads(rows_json) if isinstance(rows_json, str) else rows_json
		mapping_config = json.loads(mapping_json) if mapping_json and isinstance(mapping_json, str) else {}
		series_cfg = json.loads(series_config) if series_config and isinstance(series_config, str) else {}
		
		# Get mapping rules
		mappings = frappe.get_all(
			"Bank Import Mapping",
			filters={"enabled": 1},
			fields=["*"],
			order_by="priority ASC"
		)
		
		results = {
			"success": 0,
			"failed": 0,
			"ignored": 0,
			"errors": [],
			"created_docs": []
		}
		
		for row_idx in rows_to_apply:
			if row_idx >= len(import_doc.bank_import_rows):
				continue
			
			row = import_doc.bank_import_rows[row_idx]
			
			try:
				# Skip already processed
				if row.status in ["Applied", "Ignored"]:
					results["ignored"] += 1
					continue
				
				# Check for duplicates
				duplicate_ref = f"{row.reference}|{abs(flt(row.amount))}|{row.posting_date}"
				existing_doc = check_duplicate(duplicate_ref)
				if existing_doc:
					row.status = "Ignored"
					row.error_log = f"Already imported: {existing_doc}"
					results["ignored"] += 1
					results["errors"].append({"row": row.row_no, "error": row.error_log, "warning": True})
					continue
				
				# Get row-specific mapping config
				row_mapping_config = mapping_config.get(str(row_idx), {})
				
				# Determine action - use UI config first, then row suggestion, then auto
				action = row_mapping_config.get("action") or row.suggested_action or "Auto"
				
				if action == "Ignore":
					row.status = "Ignored"
					results["ignored"] += 1
					continue
				
				# Match against mapping rules
				from bank_statement_import.bank_statement_import.doctype.bank_import_mapping.bank_import_mapping import BankImportMapping
				row_data = {
					"narration": row.narration,
					"party_name": row.party_name,
					"reference": row.reference,
					"amount": row.amount
				}
				matched_mapping = BankImportMapping.match_row(row_data, mappings)
				
				# Get row-specific mapping config
				row_mapping_config = mapping_config.get(str(row_idx), {})
				
				# Create document based on action
				created_doc = None
				
				if action == "Internal Transfer" or (matched_mapping and matched_mapping.get("direction") == "transfer"):
					# Create internal transfer Payment Entry
					created_doc = create_internal_transfer(row, import_doc, matched_mapping, row_mapping_config, series_cfg)
				elif action == "Payment Entry" or (matched_mapping and matched_mapping.get("target_type") == "Payment Entry"):
					# Create Payment Entry
					created_doc = create_payment_entry(row, import_doc, matched_mapping, row_mapping_config, series_cfg)
				elif action == "Journal Entry" or (matched_mapping and matched_mapping.get("target_type") == "Journal Entry"):
					# Create Journal Entry
					created_doc = create_journal_entry(row, import_doc, matched_mapping, row_mapping_config, series_cfg)
				else:
					# Auto-detect
					if row.dr_cr_flag == "Cr":
						# Credit = money in = Payment Entry Receive
						created_doc = create_payment_entry(row, import_doc, matched_mapping, row_mapping_config, series_cfg)
					else:
						# Debit = money out = Payment Entry Pay or Journal Entry
						created_doc = create_payment_entry(row, import_doc, matched_mapping, row_mapping_config, series_cfg)
				
				if created_doc:
					row.status = "Applied"
					row.applied_doc_type = created_doc.doctype
					row.applied_doc = created_doc.name
					results["success"] += 1
					results["created_docs"].append({
						"doctype": created_doc.doctype,
						"name": created_doc.name
					})
				else:
					row.status = "Failed"
					row.error_log = "Could not create document"
					results["failed"] += 1
					
			except Exception as e:
				frappe.log_error(message=str(e), title=f"Bank Import Row {row.row_no} Apply Error")
				row.status = "Failed"
				row.error_log = str(e)
				results["failed"] += 1
				results["errors"].append({"row": row.row_no, "error": str(e)})
				frappe.db.rollback()  # Rollback this row only
		
		# Save import doc
		import_doc.save()
		frappe.db.commit()
		
		return {
			"success": True,
			"summary": results
		}
		
	except Exception as e:
		frappe.log_error(message=str(e), title="Bank Import Apply Error")
		frappe.db.rollback()
		return {
			"success": False,
			"error": str(e)
		}


def check_duplicate(bank_import_reference):
	"""Check if transaction already imported, return document name if found"""
	if not bank_import_reference:
		return None
	
	# Check Payment Entry
	pe_name = frappe.db.get_value("Payment Entry", {"bank_import_reference": bank_import_reference}, "name")
	if pe_name:
		return f"Payment Entry: {pe_name}"
	
	# Check Journal Entry
	je_name = frappe.db.get_value("Journal Entry", {"bank_import_reference": bank_import_reference}, "name")
	if je_name:
		return f"Journal Entry: {je_name}"
	
	return None


def create_internal_transfer(row, import_doc, matched_mapping, mapping_config, series_config=None):
	"""
	Create Payment Entry for internal transfer (ATM/Cash withdrawal)
	
	Args:
		row: Bank Import Row child table row
		import_doc: Parent Bank Import File doc
		matched_mapping: Matched Bank Import Mapping doc dict
		mapping_config: Additional mapping from UI
		series_config: Dict with payment_entry_series and journal_entry_series
		
	Returns:
		Created Payment Entry doc
	"""
	# Determine cash account
	cash_account = None
	if matched_mapping and matched_mapping.get("cash_account"):
		cash_account = matched_mapping.get("cash_account")
	elif mapping_config.get("cash_account"):
		cash_account = mapping_config.get("cash_account")
	else:
		# Try to find default cash account
		cash_account = frappe.db.get_value("Account", {
			"company": import_doc.company,
			"account_type": "Cash",
			"is_group": 0
		}, "name")
	
	if not cash_account:
		frappe.throw("Cash account not found for internal transfer")
	
	# Create Payment Entry
	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Internal Transfer"
	pe.company = import_doc.company
	pe.posting_date = row.posting_date
	pe.paid_from = import_doc.bank_account
	pe.paid_to = cash_account
	pe.paid_amount = flt(row.amount)
	pe.received_amount = flt(row.amount)
	# Ensure reference_no is never empty
	# Check each field explicitly for empty strings
	ref_no = None
	for field in [row.reference, row.cheque_no, row.narration]:
		if field and str(field).strip():
			ref_no = str(field).strip()
			break
	
	if not ref_no:
		ref_no = f"BANK-TRANSFER-{row.row_no}"
	
	pe.reference_no = ref_no[:140]
	pe.reference_date = row.posting_date if row.posting_date else frappe.utils.today()
	pe.remarks = row.narration if row.narration else "Bank to Cash Transfer"
	
	# Set custom field for duplicate prevention
	pe.bank_import_reference = f"{row.reference}|{abs(flt(row.amount))}|{row.posting_date}"
	
	pe.insert()
	pe.submit()
	
	return pe


def create_payment_entry(row, import_doc, matched_mapping, mapping_config, series_config=None):
	"""
	Create Payment Entry for customer/supplier payment
	
	Args:
		row: Bank Import Row child table row
		import_doc: Parent Bank Import File doc
		matched_mapping: Matched Bank Import Mapping doc dict
		mapping_config: Additional mapping from UI
		series_config: Dict with payment_entry_series and journal_entry_series
		
	Returns:
		Created Payment Entry doc or Journal Entry doc if party info missing
	"""
	# Determine payment type and party
	payment_type = "Receive" if row.dr_cr_flag == "Cr" else "Pay"
	party_type = None
	party = None
	paid_from = None
	paid_to = None
	
	if matched_mapping:
		party_type = matched_mapping.get("party_type")
		# Try to find party by fuzzy match
		if party_type and row.party_name:
			party = find_party(party_type, row.party_name)
	
	# Override from mapping config
	if mapping_config.get("party_type"):
		party_type = mapping_config.get("party_type")
	if mapping_config.get("party"):
		party = mapping_config.get("party")
	
	# Fuzzy match fallback: If party_type is set but party is not, try to resolve from party_name
	if party_type and not party:
		# Try fuzzy matching with party_name from row or mapping
		party_name_search = mapping_config.get("party") or row.party_name
		if party_name_search:
			try:
				# Attempt exact match first
				if frappe.db.exists(party_type, party_name_search):
					party = party_name_search
				else:
					# Fuzzy search using LIKE
					found = frappe.get_all(
						party_type,
						filters=[["name", "like", f"%{party_name_search}%"]],
						limit_page_length=1
					)
					if found:
						party = found[0].name
						frappe.msgprint(f"Auto-matched '{party_name_search}' to {party_type}: {party}")
					else:
						# Log warning but don't throw - let validation below handle it
						frappe.log_error(
							f"No {party_type} found matching '{party_name_search}' for Row #{row.row_no}",
							"Bank Import - Party Not Found"
						)
			except Exception as e:
				frappe.log_error(
					f"Error during party fuzzy match: {str(e)}",
					"Bank Import - Party Match Error"
				)
	
	# Validate party info - both party_type and party must be present (only for Payment Entry)
	# Skip validation if this is for Journal Entry (which doesn't use party)
	if party_type and not party:
		# Party type selected but no party found - provide helpful error
		party_search = mapping_config.get("party") or row.party_name or "not provided"
		frappe.throw(
			f"Row #{row.row_no}: Party Type '{party_type}' selected but no matching {party_type} found for '{party_search}'. " +
			f"Please select a valid {party_type} from the dropdown or leave Party Type as 'None'."
		)
	
	# Get target account from config
	has_target_account = (matched_mapping and matched_mapping.get("target_account")) or mapping_config.get("target_account")
	
	# Set accounts based on payment type
	if payment_type == "Receive":
		paid_to = import_doc.bank_account
		if matched_mapping and matched_mapping.get("target_account"):
			paid_from = matched_mapping.get("target_account")
		elif mapping_config.get("target_account"):
			paid_from = mapping_config.get("target_account")
		else:
			# Get default receivable account
			paid_from = get_party_account(party_type, party, import_doc.company, "receivable")
	else:  # Pay
		paid_from = import_doc.bank_account
		if matched_mapping and matched_mapping.get("target_account"):
			paid_to = matched_mapping.get("target_account")
		elif mapping_config.get("target_account"):
			paid_to = mapping_config.get("target_account")
		else:
			# Get default payable account
			paid_to = get_party_account(party_type, party, import_doc.company, "payable")
	
	# Create Payment Entry
	pe = frappe.new_doc("Payment Entry")
	
	# Set naming series if provided
	if series_config and series_config.get("payment_entry_series"):
		pe.naming_series = series_config.get("payment_entry_series")
	
	pe.payment_type = payment_type
	pe.company = import_doc.company
	pe.posting_date = row.posting_date
	
	if party_type and party:
		pe.party_type = party_type
		pe.party = party
	
	pe.paid_from = paid_from
	pe.paid_to = paid_to
	pe.paid_amount = flt(row.amount)
	pe.received_amount = flt(row.amount)
	
	# Use narration as reference details (cheque details)
	# Priority: reference > cheque_no > narration > fallback
	# Check each field explicitly for empty strings
	ref_no = None
	for field in [row.reference, row.cheque_no, row.narration]:
		if field and str(field).strip():
			ref_no = str(field).strip()
			break
	
	if not ref_no:
		ref_no = f"BANK-{row.row_no}"
	
	pe.reference_no = ref_no[:140]  # Limit length for field
	pe.reference_date = row.posting_date if row.posting_date else frappe.utils.today()
	pe.remarks = row.narration if row.narration else "Bank Import"
	
	# Set cost center if provided from UI
	if mapping_config.get("cost_center"):
		pe.cost_center = mapping_config.get("cost_center")
	
	# Set custom field for duplicate prevention
	pe.bank_import_reference = f"{row.reference}|{abs(flt(row.amount))}|{row.posting_date}"
	
	pe.insert()
	pe.submit()
	
	return pe


def create_journal_entry(row, import_doc, matched_mapping, mapping_config, series_config=None):
	"""
	Create Journal Entry for expense/shareholder transactions
	
	Args:
		row: Bank Import Row child table row
		import_doc: Parent Bank Import File doc
		matched_mapping: Matched Bank Import Mapping doc dict
		mapping_config: Additional mapping from UI
		series_config: Dict with payment_entry_series and journal_entry_series
		
	Returns:
		Created Journal Entry doc
	"""
	# Determine target account
	target_account = None
	
	# Check if account provided from UI (for Journal Entry)
	if mapping_config.get("account"):
		target_account = mapping_config.get("account")
	elif matched_mapping and matched_mapping.get("target_account"):
		target_account = matched_mapping.get("target_account")
	elif mapping_config.get("target_account"):
		target_account = mapping_config.get("target_account")
	else:
		# Default to a general expense account
		target_account = frappe.db.get_value("Account", {
			"company": import_doc.company,
			"account_type": "Expense Account",
			"is_group": 0
		}, "name")
	
	if not target_account:
		frappe.throw("Target account not found for journal entry. Please select an account.")
	
	# Determine cost center
	cost_center = None
	if matched_mapping and matched_mapping.get("cost_center"):
		cost_center = matched_mapping.get("cost_center")
	elif mapping_config.get("cost_center"):
		cost_center = mapping_config.get("cost_center")
	else:
		# Get default cost center
		cost_center = frappe.db.get_value("Company", import_doc.company, "cost_center")
	
	# Create Journal Entry
	je = frappe.new_doc("Journal Entry")
	
	# Set naming series if provided
	if series_config and series_config.get("journal_entry_series"):
		je.naming_series = series_config.get("journal_entry_series")
	
	je.voucher_type = "Bank Entry"
	je.company = import_doc.company
	je.posting_date = row.posting_date
	# Ensure cheque_no is never empty for bank transactions
	# Check each field explicitly for empty strings
	cheque_ref = None
	for field in [row.reference, row.narration, row.cheque_no]:
		if field and str(field).strip():
			cheque_ref = str(field).strip()
			break
	
	if not cheque_ref:
		cheque_ref = f"BANK-JE-{row.row_no}"
	
	je.cheque_no = cheque_ref[:140]  # Limit length
	je.cheque_date = row.posting_date if row.posting_date else frappe.utils.today()
	je.user_remark = row.narration if row.narration else "Bank Import"
	
	# Add accounts
	if row.dr_cr_flag == "Dr":
		# Debit = money out from bank
		# Debit target account, Credit bank
		je.append("accounts", {
			"account": target_account,
			"debit_in_account_currency": flt(row.amount),
			"cost_center": cost_center
		})
		je.append("accounts", {
			"account": import_doc.bank_account,
			"credit_in_account_currency": flt(row.amount),
			"cost_center": cost_center
		})
	else:
		# Credit = money in to bank
		# Debit bank, Credit target account
		je.append("accounts", {
			"account": import_doc.bank_account,
			"debit_in_account_currency": flt(row.amount),
			"cost_center": cost_center
		})
		je.append("accounts", {
			"account": target_account,
			"credit_in_account_currency": flt(row.amount),
			"cost_center": cost_center
		})
	
	# Set custom field for duplicate prevention
	je.bank_import_reference = f"{row.reference}|{abs(flt(row.amount))}|{row.posting_date}"
	
	je.insert()
	je.submit()
	
	return je


def find_party(party_type, party_name):
	"""Find party by fuzzy name match"""
	if not party_name:
		return None
	
	# Try exact match first
	exact_match = frappe.db.exists(party_type, party_name)
	if exact_match:
		return party_name
	
	# Try fuzzy match
	parties = frappe.get_all(
		party_type,
		filters={"name": ["like", f"%{party_name}%"]},
		limit=1
	)
	
	if parties:
		return parties[0].name
	
	return None


def get_party_account(party_type, party, company, account_type):
	"""Get party's receivable or payable account"""
	if not party_type or not party:
		# Return default account
		if account_type == "receivable":
			return frappe.db.get_value("Company", company, "default_receivable_account")
		else:
			return frappe.db.get_value("Company", company, "default_payable_account")
	
	try:
		if party_type == "Customer":
			return frappe.db.get_value("Customer", party, "default_receivable_account") or \
				   frappe.db.get_value("Company", company, "default_receivable_account")
		elif party_type == "Supplier":
			return frappe.db.get_value("Supplier", party, "default_payable_account") or \
				   frappe.db.get_value("Company", company, "default_payable_account")
	except:
		pass
	
	return None


@frappe.whitelist()
def get_naming_series():
	"""Get naming series options for Payment Entry and Journal Entry"""
	pe_series = []
	je_series = []
	
	# Try to get from meta's naming_series field options
	try:
		pe_meta = frappe.get_meta("Payment Entry")
		naming_series_field = pe_meta.get_field("naming_series")
		if naming_series_field and naming_series_field.options:
			pe_series = [s.strip() for s in naming_series_field.options.split('\n') if s.strip()]
	except:
		pass
	
	try:
		je_meta = frappe.get_meta("Journal Entry")
		naming_series_field = je_meta.get_field("naming_series")
		if naming_series_field and naming_series_field.options:
			je_series = [s.strip() for s in naming_series_field.options.split('\n') if s.strip()]
	except:
		pass
	
	# Fallback to default series if none found
	if not pe_series:
		pe_series = ["PE-"]
	if not je_series:
		je_series = ["JE-"]
	
	return {
		"payment_entry_series": pe_series,
		"journal_entry_series": je_series
	}
