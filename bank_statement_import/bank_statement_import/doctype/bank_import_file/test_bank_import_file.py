# Copyright (c) 2025, Nandu Custom and Contributors
# See license.txt

import frappe
import unittest
import os
import json
from frappe.utils import getdate, nowdate, flt
import pandas as pd
from io import BytesIO


class TestBankImportFile(unittest.TestCase):
	"""Test cases for Bank Import functionality"""
	
	@classmethod
	def setUpClass(cls):
		"""Set up test data once for all tests"""
		cls.company = frappe.get_doc("Company", frappe.defaults.get_user_default("Company") or "_Test Company")
		
		# Create test bank account if not exists
		if not frappe.db.exists("Account", "Test Bank Account - TC"):
			bank_acc = frappe.get_doc({
				"doctype": "Account",
				"account_name": "Test Bank Account",
				"parent_account": "Bank Accounts - TC",
				"company": cls.company.name,
				"account_type": "Bank",
				"is_group": 0
			})
			bank_acc.insert()
		cls.bank_account = "Test Bank Account - TC"
		
		# Create test cash account if not exists
		if not frappe.db.exists("Account", "Test Cash Account - TC"):
			cash_acc = frappe.get_doc({
				"doctype": "Account",
				"account_name": "Test Cash Account",
				"parent_account": "Cash - TC",
				"company": cls.company.name,
				"account_type": "Cash",
				"is_group": 0
			})
			cash_acc.insert()
		cls.cash_account = "Test Cash Account - TC"
		
		# Create test expense account if not exists
		if not frappe.db.exists("Account", "Test Expense Account - TC"):
			exp_acc = frappe.get_doc({
				"doctype": "Account",
				"account_name": "Test Expense Account",
				"parent_account": "Expenses - TC",
				"company": cls.company.name,
				"account_type": "Expense Account",
				"is_group": 0
			})
			exp_acc.insert()
		cls.expense_account = "Test Expense Account - TC"
		
		# Create test customer
		if not frappe.db.exists("Customer", "Test Customer"):
			customer = frappe.get_doc({
				"doctype": "Customer",
				"customer_name": "Test Customer",
				"customer_type": "Individual",
				"customer_group": "Individual",
				"territory": "All Territories"
			})
			customer.insert()
		
		# Create test supplier
		if not frappe.db.exists("Supplier", "Test Supplier"):
			supplier = frappe.get_doc({
				"doctype": "Supplier",
				"supplier_name": "Test Supplier",
				"supplier_group": "All Supplier Groups"
			})
			supplier.insert()
		
		# Create test mapping rules
		cls.create_test_mappings()
		
		frappe.db.commit()
	
	@classmethod
	def create_test_mappings(cls):
		"""Create test mapping rules"""
		# ATM mapping
		if not frappe.db.exists("Bank Import Mapping", "ATM Withdrawal"):
			atm_mapping = frappe.get_doc({
				"doctype": "Bank Import Mapping",
				"mapping_name": "ATM Withdrawal",
				"enabled": 1,
				"priority": 1,
				"match_field": "narration",
				"match_type": "contains",
				"match_value": "atm",
				"target_type": "Internal Transfer",
				"direction": "transfer",
				"bank_account": cls.bank_account,
				"cash_account": cls.cash_account
			})
			atm_mapping.insert()
		
		# Customer payment mapping
		if not frappe.db.exists("Bank Import Mapping", "Customer Payment"):
			cust_mapping = frappe.get_doc({
				"doctype": "Bank Import Mapping",
				"mapping_name": "Customer Payment",
				"enabled": 1,
				"priority": 10,
				"match_field": "narration",
				"match_type": "contains",
				"match_value": "payment received",
				"target_type": "Payment Entry",
				"party_type": "Customer",
				"direction": "in"
			})
			cust_mapping.insert()
	
	def tearDown(self):
		"""Clean up after each test"""
		frappe.db.rollback()
	
	def test_parse_sample_excel(self):
		"""Test parsing a sample Excel file"""
		# Create sample Excel file
		sample_data = {
			"Date": ["2025-01-01", "2025-01-02", "2025-01-03"],
			"Narration": ["ATM Withdrawal", "Payment Received from Customer", "Office Supplies"],
			"Amount": [5000, 25000, 1500],
			"Dr/Cr": ["Dr", "Cr", "Dr"],
			"Reference": ["ATM001", "PAY002", "INV003"],
			"Cheque No": ["", "CHQ123", ""]
		}
		
		df = pd.DataFrame(sample_data)
		excel_path = "/tmp/test_bank_statement.xlsx"
		df.to_excel(excel_path, index=False)
		
		# Parse file
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import parse_bank_sheet
		rows = parse_bank_sheet(excel_path)
		
		self.assertTrue(len(rows) > 0, "Should parse at least one row")
		self.assertEqual(len(rows), 3, "Should parse 3 rows")
		
		# Check first row (ATM)
		self.assertIn("atm", rows[0]["narration"].lower())
		self.assertEqual(rows[0]["amount"], 5000)
		
		# Clean up
		if os.path.exists(excel_path):
			os.remove(excel_path)
	
	def test_column_mapping_suggestion(self):
		"""Test automatic column mapping suggestion"""
		sample_data = {
			"Transaction Date": ["2025-01-01"],
			"Description": ["Test Transaction"],
			"Debit Amount": [1000],
			"Reference Number": ["REF001"]
		}
		
		df = pd.DataFrame(sample_data)
		
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import suggest_column_mapping
		mapping = suggest_column_mapping(df)
		
		self.assertIsNotNone(mapping.get("posting_date"))
		self.assertIsNotNone(mapping.get("narration"))
		self.assertIsNotNone(mapping.get("amount"))
	
	def test_mapping_rules_matching(self):
		"""Test mapping rule matching logic"""
		from bank_statement_import.bank_statement_import.doctype.bank_import_mapping.bank_import_mapping import BankImportMapping
		
		# Get test mappings
		mappings = frappe.get_all(
			"Bank Import Mapping",
			filters={"enabled": 1},
			fields=["*"],
			order_by="priority ASC"
		)
		
		# Test ATM match
		atm_row = {
			"narration": "ATM WITHDRAWAL AT MAIN STREET",
			"amount": 5000,
			"reference": "ATM001"
		}
		matched = BankImportMapping.match_row(atm_row, mappings)
		self.assertIsNotNone(matched, "Should match ATM mapping")
		self.assertEqual(matched.get("target_type"), "Internal Transfer")
		
		# Test customer payment match
		payment_row = {
			"narration": "Payment Received from XYZ Corp",
			"amount": 25000,
			"reference": "PAY001"
		}
		matched = BankImportMapping.match_row(payment_row, mappings)
		self.assertIsNotNone(matched, "Should match customer payment mapping")
	
	def test_create_internal_transfer(self):
		"""Test creating internal transfer Payment Entry for ATM withdrawal"""
		# Create Bank Import File
		import_doc = frappe.get_doc({
			"doctype": "Bank Import File",
			"file": "/tmp/test.xlsx",
			"bank_account": self.bank_account,
			"company": self.company.name,
			"status": "Draft"
		})
		import_doc.insert()
		
		# Add ATM row
		row = import_doc.append("bank_import_rows", {
			"row_no": 1,
			"posting_date": nowdate(),
			"narration": "ATM Withdrawal",
			"amount": 5000,
			"dr_cr_flag": "Dr",
			"reference": "ATM001",
			"status": "Pending",
			"suggested_action": "Internal Transfer"
		})
		import_doc.save()
		
		# Create internal transfer
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import create_internal_transfer
		
		matched_mapping = frappe.get_doc("Bank Import Mapping", "ATM Withdrawal")
		pe = create_internal_transfer(row, import_doc, matched_mapping.as_dict(), {})
		
		self.assertIsNotNone(pe, "Payment Entry should be created")
		self.assertEqual(pe.payment_type, "Internal Transfer")
		self.assertEqual(pe.paid_from, self.bank_account)
		self.assertEqual(pe.paid_to, self.cash_account)
		self.assertEqual(pe.paid_amount, 5000)
		self.assertEqual(pe.docstatus, 1, "Payment Entry should be submitted")
		
		# Check duplicate reference
		self.assertTrue(pe.bank_import_reference, "Should have bank_import_reference")
		
		# Clean up
		pe.cancel()
		import_doc.delete()
	
	def test_create_payment_entry_customer(self):
		"""Test creating Payment Entry for customer payment"""
		# Create Bank Import File
		import_doc = frappe.get_doc({
			"doctype": "Bank Import File",
			"file": "/tmp/test.xlsx",
			"bank_account": self.bank_account,
			"company": self.company.name,
			"status": "Draft"
		})
		import_doc.insert()
		
		# Add customer payment row
		row = import_doc.append("bank_import_rows", {
			"row_no": 1,
			"posting_date": nowdate(),
			"narration": "Payment from Test Customer",
			"amount": 10000,
			"dr_cr_flag": "Cr",
			"reference": "PAY001",
			"party_name": "Test Customer",
			"status": "Pending",
			"suggested_action": "Payment Entry"
		})
		import_doc.save()
		
		# Create payment entry
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import create_payment_entry
		
		mapping_config = {
			"party_type": "Customer",
			"party": "Test Customer"
		}
		pe = create_payment_entry(row, import_doc, None, mapping_config)
		
		self.assertIsNotNone(pe, "Payment Entry should be created")
		self.assertEqual(pe.payment_type, "Receive")
		self.assertEqual(pe.party_type, "Customer")
		self.assertEqual(pe.party, "Test Customer")
		self.assertEqual(pe.paid_to, self.bank_account)
		self.assertEqual(pe.paid_amount, 10000)
		self.assertEqual(pe.docstatus, 1, "Payment Entry should be submitted")
		
		# Clean up
		pe.cancel()
		import_doc.delete()
	
	def test_create_journal_entry(self):
		"""Test creating Journal Entry for expense"""
		# Create Bank Import File
		import_doc = frappe.get_doc({
			"doctype": "Bank Import File",
			"file": "/tmp/test.xlsx",
			"bank_account": self.bank_account,
			"company": self.company.name,
			"status": "Draft"
		})
		import_doc.insert()
		
		# Add expense row
		row = import_doc.append("bank_import_rows", {
			"row_no": 1,
			"posting_date": nowdate(),
			"narration": "Office Supplies Purchase",
			"amount": 1500,
			"dr_cr_flag": "Dr",
			"reference": "EXP001",
			"status": "Pending",
			"suggested_action": "Journal Entry"
		})
		import_doc.save()
		
		# Create journal entry
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import create_journal_entry
		
		mapping_config = {
			"target_account": self.expense_account,
			"cost_center": self.company.cost_center
		}
		je = create_journal_entry(row, import_doc, None, mapping_config)
		
		self.assertIsNotNone(je, "Journal Entry should be created")
		self.assertEqual(len(je.accounts), 2, "Should have 2 accounts")
		self.assertEqual(je.docstatus, 1, "Journal Entry should be submitted")
		
		# Verify accounts
		debit_account = [acc for acc in je.accounts if acc.debit_in_account_currency > 0][0]
		credit_account = [acc for acc in je.accounts if acc.credit_in_account_currency > 0][0]
		
		self.assertEqual(debit_account.account, self.expense_account)
		self.assertEqual(credit_account.account, self.bank_account)
		self.assertEqual(debit_account.debit_in_account_currency, 1500)
		
		# Clean up
		je.cancel()
		import_doc.delete()
	
	def test_duplicate_prevention(self):
		"""Test duplicate transaction prevention"""
		# Create first Payment Entry
		pe1 = frappe.get_doc({
			"doctype": "Payment Entry",
			"payment_type": "Internal Transfer",
			"company": self.company.name,
			"posting_date": nowdate(),
			"paid_from": self.bank_account,
			"paid_to": self.cash_account,
			"paid_amount": 5000,
			"received_amount": 5000,
			"bank_import_reference": "REF001|5000|2025-01-01"
		})
		pe1.insert()
		pe1.submit()
		
		# Check duplicate
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import check_duplicate
		
		is_duplicate = check_duplicate("REF001|5000|2025-01-01")
		self.assertTrue(is_duplicate, "Should detect duplicate")
		
		is_new = check_duplicate("REF002|3000|2025-01-02")
		self.assertFalse(is_new, "Should not detect as duplicate")
		
		# Clean up
		pe1.cancel()
		pe1.delete()
	
	def test_full_import_workflow(self):
		"""Test complete import workflow end-to-end"""
		# Create sample Excel
		sample_data = {
			"Date": ["2025-01-01", "2025-01-02"],
			"Narration": ["ATM Withdrawal", "Payment from Customer"],
			"Amount": [5000, 15000],
			"Dr/Cr": ["Dr", "Cr"],
			"Reference": ["ATM001", "PAY001"]
		}
		
		df = pd.DataFrame(sample_data)
		excel_path = "/tmp/test_full_import.xlsx"
		df.to_excel(excel_path, index=False)
		
		# Parse preview
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import parse_preview
		
		result = parse_preview(excel_path, self.bank_account, self.company.name)
		
		self.assertTrue(result.get("success"))
		self.assertEqual(len(result.get("preview_data")), 2)
		
		# Create import doc
		import_doc = frappe.get_doc({
			"doctype": "Bank Import File",
			"file": excel_path,
			"bank_account": self.bank_account,
			"company": self.company.name,
			"status": "Parsed"
		})
		
		for row_data in result.get("preview_data"):
			import_doc.append("bank_import_rows", {
				"row_no": row_data["row_no"],
				"posting_date": row_data["posting_date"],
				"narration": row_data["narration"],
				"amount": row_data["amount"],
				"dr_cr_flag": row_data["dr_cr_flag"],
				"reference": row_data["reference"],
				"status": "Pending",
				"raw_json": row_data["raw_json"]
			})
		
		import_doc.insert()
		
		# Apply import
		from bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file import apply_import
		
		rows_to_apply = [0, 1]  # Apply both rows
		mapping_config = {
			"0": {"cash_account": self.cash_account},
			"1": {"party_type": "Customer", "party": "Test Customer"}
		}
		
		result = apply_import(import_doc.name, json.dumps(rows_to_apply), json.dumps(mapping_config))
		
		self.assertTrue(result.get("success"))
		summary = result.get("summary")
		self.assertGreater(summary.get("success", 0), 0, "Should have successful imports")
		
		# Verify documents created
		self.assertGreater(len(summary.get("created_docs", [])), 0)
		
		# Clean up
		for doc_info in summary.get("created_docs", []):
			doc = frappe.get_doc(doc_info["doctype"], doc_info["name"])
			doc.cancel()
			doc.delete()
		
		import_doc.delete()
		
		if os.path.exists(excel_path):
			os.remove(excel_path)


def get_test_records():
	"""Return test records for fixtures"""
	return []
