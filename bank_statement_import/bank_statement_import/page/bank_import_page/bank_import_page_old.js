// Copyright (c) 2025, Nandu Custom and contributors
// For license information, please see license.txt

frappe.pages['bank-import-page'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Bank Statement Import',
		single_column: true
	});

	new BankImportPage(page);
};

class BankImportPage {
	constructor(page) {
		this.page = page;
		this.make_layout();
		this.setup_upload_form();
	}

	make_layout() {
		this.page.add_inner_button(__('New Import'), () => {
			this.reset_form();
		});

		// Create main container
		this.$container = $('<div class="bank-import-container" style="padding: 15px;">').appendTo(this.page.main);

		// Upload section
		this.$upload_section = $(`
			<div class="upload-section frappe-card">
				<div class="frappe-card-head">
					<strong>Step 1: Upload Bank Statement</strong>
				</div>
				<div class="frappe-card-body">
					<div class="upload-form"></div>
				</div>
			</div>
		`).appendTo(this.$container);

		// Preview section (hidden initially)
		this.$preview_section = $(`
			<div class="preview-section frappe-card" style="display: none; margin-top: 20px;">
				<div class="frappe-card-head">
					<strong>Step 2: Preview & Configure</strong>
				</div>
				<div class="frappe-card-body">
					<div class="preview-controls" style="margin-bottom: 15px;"></div>
					<div class="preview-table"></div>
				</div>
			</div>
		`).appendTo(this.$container);

		// Results section (hidden initially)
		this.$results_section = $(`
			<div class="results-section frappe-card" style="display: none; margin-top: 20px;">
				<div class="frappe-card-head">
					<strong>Step 3: Apply Results</strong>
				</div>
				<div class="frappe-card-body">
					<div class="results-content"></div>
				</div>
			</div>
		`).appendTo(this.$container);
	}

	setup_upload_form() {
		let form_wrapper = this.$upload_section.find('.upload-form');
		
		this.upload_form = new frappe.ui.FieldGroup({
			fields: [
				{
					fieldtype: 'Link',
					fieldname: 'company',
					label: __('Company'),
					options: 'Company',
					reqd: 1,
					default: frappe.defaults.get_user_default('Company')
				},
				{
					fieldtype: 'Link',
					fieldname: 'bank_account',
					label: __('Bank Account'),
					options: 'Account',
					reqd: 1,
					get_query: () => {
						return {
							filters: {
								'account_type': 'Bank',
								'is_group': 0,
								'company': this.upload_form.get_value('company')
							}
						};
					}
				},
				{
					fieldtype: 'Link',
					fieldname: 'mapping_template',
					label: __('Mapping Template (Optional)'),
					options: 'Bank Import Mapping'
				},
				{
					fieldtype: 'Attach',
					fieldname: 'file',
					label: __('Bank Statement Excel File'),
					reqd: 1,
					options: {
						restrictions: {
							allowed_file_types: ['.xlsx', '.xls']
						}
					}
				},
				{
					fieldtype: 'Column Break'
				},
				{
					fieldtype: 'Button',
					fieldname: 'parse_btn',
					label: __('Parse & Preview'),
					click: () => this.parse_file()
				}
			],
			body: form_wrapper
		});

		this.upload_form.make();
	}

	reset_form() {
		this.$preview_section.hide();
		this.$results_section.hide();
		this.upload_form.clear();
		this.preview_data = null;
		this.import_doc_name = null;
	}

	parse_file() {
		let values = this.upload_form.get_values();
		
		if (!values.file || !values.bank_account || !values.company) {
			frappe.msgprint(__('Please fill all required fields'));
			return;
		}

		frappe.show_alert({message: __('Parsing file...'), indicator: 'blue'});

		frappe.call({
			method: 'bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file.parse_preview',
			args: {
				file_url: values.file,
				bank_account: values.bank_account,
				company: values.company,
				mapping_template: values.mapping_template
			},
			callback: (r) => {
				if (r.message && r.message.success) {
					this.preview_data = r.message;
					this.show_preview();
					frappe.show_alert({message: __('File parsed successfully'), indicator: 'green'});
				} else {
					frappe.msgprint({
						title: __('Parse Error'),
						message: r.message.error || 'Failed to parse file',
						indicator: 'red'
					});
				}
			}
		});
	}

	show_preview() {
		this.$preview_section.show();
		
		let controls = this.$preview_section.find('.preview-controls');
		controls.empty();

		// Add control buttons
		controls.append(`
			<div style="margin-bottom: 10px;">
				<button class="btn btn-sm btn-primary" id="btn-select-all">Select All</button>
				<button class="btn btn-sm btn-default" id="btn-deselect-all">Deselect All</button>
				<button class="btn btn-sm btn-success" id="btn-apply-selected" style="margin-left: 20px;">
					Apply Selected
				</button>
				<span style="margin-left: 20px; font-weight: bold;">
					Total Rows: ${this.preview_data.total_rows}
				</span>
			</div>
		`);

		// Bind button events
		controls.find('#btn-select-all').on('click', () => {
			this.$preview_section.find('.row-checkbox').prop('checked', true);
		});

		controls.find('#btn-deselect-all').on('click', () => {
			this.$preview_section.find('.row-checkbox').prop('checked', false);
		});

		controls.find('#btn-apply-selected').on('click', () => {
			this.apply_selected();
		});

		// Build preview table
		let table_wrapper = this.$preview_section.find('.preview-table');
		table_wrapper.empty();

		let html = '<table class="table table-bordered" style="font-size: 12px;"><thead><tr>';
		html += '<th><input type="checkbox" id="checkbox-all"></th>';
		html += '<th>Row</th><th>Date</th><th>Narration</th><th>Amount</th>';
		html += '<th>Party</th><th>Ref</th><th>Suggested Action</th><th>Actions</th>';
		html += '</tr></thead><tbody>';

		this.preview_data.preview_data.forEach((row, idx) => {
			html += '<tr>';
			html += `<td><input type="checkbox" class="row-checkbox" data-idx="${idx}"></td>`;
			html += `<td>${row.row_no}</td>`;
			html += `<td>${row.posting_date || ''}</td>`;
			html += `<td>${frappe.ellipsis(row.narration || '', 50)}</td>`;
			html += `<td style="text-align: right;">${format_currency(row.amount)}</td>`;
			html += `<td>${row.party_name || ''}</td>`;
			html += `<td>${row.reference || ''}</td>`;
			html += `<td>
				<select class="form-control input-sm suggested-action" data-idx="${idx}">
					<option value="Auto" ${row.suggested_action === 'Auto' ? 'selected' : ''}>Auto</option>
					<option value="Payment Entry" ${row.suggested_action === 'Payment Entry' ? 'selected' : ''}>Payment Entry</option>
					<option value="Journal Entry" ${row.suggested_action === 'Journal Entry' ? 'selected' : ''}>Journal Entry</option>
					<option value="Internal Transfer" ${row.suggested_action === 'Internal Transfer' ? 'selected' : ''}>Internal Transfer</option>
					<option value="Ignore" ${row.suggested_action === 'Ignore' ? 'selected' : ''}>Ignore</option>
				</select>
			</td>`;
			html += `<td><button class="btn btn-xs btn-default btn-configure" data-idx="${idx}">Configure</button></td>`;
			html += '</tr>';
		});

		html += '</tbody></table>';
		table_wrapper.html(html);

		// Bind checkbox all
		table_wrapper.find('#checkbox-all').on('change', function() {
			table_wrapper.find('.row-checkbox').prop('checked', $(this).is(':checked'));
		});

		// Bind configure buttons
		table_wrapper.find('.btn-configure').on('click', (e) => {
			let idx = $(e.target).data('idx');
			this.show_configure_dialog(idx);
		});

		// Update preview_data when action changes
		table_wrapper.find('.suggested-action').on('change', (e) => {
			let idx = $(e.target).data('idx');
			let value = $(e.target).val();
			this.preview_data.preview_data[idx].suggested_action = value;
		});
	}

	show_configure_dialog(idx) {
		let row = this.preview_data.preview_data[idx];
		let action = row.suggested_action || 'Auto';

		let dialog = new frappe.ui.Dialog({
			title: `Configure Row ${row.row_no}`,
			fields: this.get_configure_fields(action),
			primary_action_label: __('Save'),
			primary_action: (values) => {
				// Store configuration
				if (!row.config) row.config = {};
				Object.assign(row.config, values);
				dialog.hide();
				frappe.show_alert({message: __('Configuration saved'), indicator: 'green'});
			}
		});

		// Set current values if any
		if (row.config) {
			dialog.set_values(row.config);
		}

		dialog.show();
	}

	get_configure_fields(action) {
		let company = this.upload_form.get_value('company');
		let bank_account = this.upload_form.get_value('bank_account');

		if (action === 'Internal Transfer') {
			return [
				{
					fieldtype: 'Link',
					fieldname: 'cash_account',
					label: __('Cash Account'),
					options: 'Account',
					reqd: 1,
					get_query: () => ({
						filters: {
							'account_type': 'Cash',
							'is_group': 0,
							'company': company
						}
					})
				}
			];
		} else if (action === 'Payment Entry') {
			return [
				{
					fieldtype: 'Select',
					fieldname: 'payment_type',
					label: __('Payment Type'),
					options: 'Receive\nPay',
					reqd: 1
				},
				{
					fieldtype: 'Select',
					fieldname: 'party_type',
					label: __('Party Type'),
					options: '\nCustomer\nSupplier'
				},
				{
					fieldtype: 'Dynamic Link',
					fieldname: 'party',
					label: __('Party'),
					options: 'party_type',
					depends_on: 'party_type'
				},
				{
					fieldtype: 'Link',
					fieldname: 'target_account',
					label: __('Counterparty Account'),
					options: 'Account',
					get_query: () => ({
						filters: {
							'is_group': 0,
							'company': company
						}
					})
				}
			];
		} else if (action === 'Journal Entry') {
			return [
				{
					fieldtype: 'Link',
					fieldname: 'target_account',
					label: __('Target Account'),
					options: 'Account',
					reqd: 1,
					get_query: () => ({
						filters: {
							'is_group': 0,
							'company': company
						}
					})
				},
				{
					fieldtype: 'Link',
					fieldname: 'cost_center',
					label: __('Cost Center'),
					options: 'Cost Center',
					get_query: () => ({
						filters: {
							'company': company
						}
					})
				}
			];
		}

		return [];
	}

	apply_selected() {
		// Get selected rows
		let selected_indices = [];
		this.$preview_section.find('.row-checkbox:checked').each(function() {
			selected_indices.push($(this).data('idx'));
		});

		if (selected_indices.length === 0) {
			frappe.msgprint(__('Please select at least one row'));
			return;
		}

		// Prepare rows data with configurations
		let rows_data = selected_indices.map(idx => {
			let row = this.preview_data.preview_data[idx];
			return {
				...row,
				config: row.config || {}
			};
		});

		frappe.confirm(
			__('Apply {0} selected transactions?', [selected_indices.length]),
			() => {
				this.create_import_doc_and_apply(rows_data, selected_indices);
			}
		);
	}

	create_import_doc_and_apply(rows_data, selected_indices) {
		frappe.show_alert({message: __('Creating import document...'), indicator: 'blue'});

		// First create Bank Import File document
		let values = this.upload_form.get_values();
		
		frappe.call({
			method: 'frappe.client.insert',
			args: {
				doc: {
					doctype: 'Bank Import File',
					file: values.file,
					bank_account: values.bank_account,
					company: values.company,
					mapping_template: values.mapping_template,
					status: 'Parsed',
					bank_import_rows: rows_data.map(row => ({
						row_no: row.row_no,
						posting_date: row.posting_date,
						value_date: row.value_date,
						amount: row.amount,
						dr_cr_flag: row.dr_cr_flag,
						narration: row.narration,
						party_name: row.party_name,
						cheque_no: row.cheque_no,
						reference: row.reference,
						suggested_action: row.suggested_action,
						status: 'Pending',
						raw_json: row.raw_json
					}))
				}
			},
			callback: (r) => {
				if (r.message) {
					this.import_doc_name = r.message.name;
					this.apply_rows(selected_indices, rows_data);
				}
			}
		});
	}

	apply_rows(selected_indices, rows_data) {
		frappe.show_alert({message: __('Applying transactions...'), indicator: 'blue'});

		// Prepare mapping config from row configurations
		let mapping_config = {};
		rows_data.forEach((row, i) => {
			if (row.config) {
				mapping_config[selected_indices[i]] = row.config;
			}
		});

		frappe.call({
			method: 'bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file.apply_import',
			args: {
				import_doc_name: this.import_doc_name,
				rows_json: JSON.stringify(selected_indices),
				mapping_json: JSON.stringify(mapping_config)
			},
			callback: (r) => {
				if (r.message && r.message.success) {
					this.show_results(r.message.summary);
				} else {
					frappe.msgprint({
						title: __('Apply Error'),
						message: r.message.error || 'Failed to apply transactions',
						indicator: 'red'
					});
				}
			}
		});
	}

	show_results(summary) {
		this.$results_section.show();
		
		let content = this.$results_section.find('.results-content');
		content.empty();

		let html = `
			<div class="alert alert-success">
				<h4>Import Complete!</h4>
				<p><strong>Success:</strong> ${summary.success} transactions</p>
				<p><strong>Failed:</strong> ${summary.failed} transactions</p>
				<p><strong>Ignored:</strong> ${summary.ignored} transactions</p>
			</div>
		`;

		if (summary.created_docs && summary.created_docs.length > 0) {
			html += '<h5>Created Documents:</h5><ul>';
			summary.created_docs.forEach(doc => {
				html += `<li><a href="/app/${doc.doctype.toLowerCase().replace(/ /g, '-')}/${doc.name}" target="_blank">
					${doc.doctype}: ${doc.name}
				</a></li>`;
			});
			html += '</ul>';
		}

		if (summary.errors && summary.errors.length > 0) {
			html += '<h5 style="color: red;">Errors:</h5><ul>';
			summary.errors.forEach(err => {
				html += `<li>Row ${err.row}: ${err.error}</li>`;
			});
			html += '</ul>';
		}

		html += `
			<div style="margin-top: 20px;">
				<a href="/app/bank-import-file/${this.import_doc_name}" target="_blank" class="btn btn-primary">
					View Import Document
				</a>
				<button class="btn btn-default" id="btn-new-import">New Import</button>
			</div>
		`;

		content.html(html);

		content.find('#btn-new-import').on('click', () => {
			this.reset_form();
		});

		// Scroll to results
		this.$results_section[0].scrollIntoView({ behavior: 'smooth' });
	}
}
