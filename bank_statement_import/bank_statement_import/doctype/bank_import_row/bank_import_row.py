# Copyright (c) 2025, Nandu Custom and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BankImportRow(Document):
	"""Child table to store parsed bank statement rows"""
	pass
