# Copyright (c) 2025, Nandu Custom and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
import re


class BankImportMapping(Document):
	"""Mapping template for automatic bank transaction classification"""
	
	def validate(self):
		"""Validate regex patterns"""
		if self.match_type == "regex":
			try:
				re.compile(self.match_value)
			except re.error as e:
				frappe.throw(f"Invalid regex pattern: {str(e)}")
	
	@staticmethod
	def match_row(row_data, mappings):
		"""
		Match a row against mapping rules and return the best match
		
		Args:
			row_data: dict with narration, party_name, reference, amount
			mappings: list of Bank Import Mapping docs sorted by priority
			
		Returns:
			Matching Bank Import Mapping doc or None
		"""
		for mapping in mappings:
			if not mapping.get("enabled"):
				continue
				
			field_value = str(row_data.get(mapping.match_field, "")).lower()
			match_value = str(mapping.match_value).lower()
			
			matched = False
			
			if mapping.match_type == "contains":
				matched = match_value in field_value
			elif mapping.match_type == "equals":
				matched = field_value == match_value
			elif mapping.match_type == "starts_with":
				matched = field_value.startswith(match_value)
			elif mapping.match_type == "ends_with":
				matched = field_value.endswith(match_value)
			elif mapping.match_type == "regex":
				try:
					matched = bool(re.search(match_value, field_value, re.IGNORECASE))
				except re.error:
					frappe.log_error(f"Invalid regex in mapping {mapping.name}: {match_value}")
					continue
			
			if matched:
				return mapping
		
		return None
