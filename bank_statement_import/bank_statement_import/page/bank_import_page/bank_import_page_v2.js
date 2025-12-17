// Copyright (c) 2025, Nandu Custom and contributors
// Simplified Bank Import Page with Inline Configuration

frappe.pages['bank-import-page'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Bank Statement Import',
		single_column: true
	});

	new SimpleBankImportPage(page);
};

class SimpleBankImportPage {
	constructor(page) {
		this.page = page;
		this.make_layout();
		this.setup_upload_form();
	}

	make_layout() {
		this.page.add_inner_button(__('New Import'), () => {
			this.reset_form();
		});

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
					<strong>Step 2: Review & Import Transactions</strong>
				</div>
				<div class="frappe-card-body">
					<div class="preview-controls" style="margin-bottom: 15px;"></div>
					<div class="preview-table"></div>
				</div>
			</div>
		`).appendTo(this.$container);

		// Results section
		this.$results_section = $(`
			<div class="results-section frappe-card" style="display: none; margin-top: 20px;">
				<div class="frappe-card-head">
					<strong>Import Results</strong>
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
					fieldtype: 'Column Break'
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
					fieldtype: 'Button',
					fieldname: 'parse_btn',
					label: __('Upload & Parse'),
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
				company: values.company
			},
			callback: (r) => {
				if (r.message && r.message.success) {
					this.preview_data = r.message;
					this.show_preview();
					frappe.show_alert({message: __('Parsed ' + r.message.total_rows + ' transactions'), indicator: 'green'});
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
		this.$results_section.hide();

		// Build controls
		let controls = this.$preview_section.find('.preview-controls');
		controls.html(`
			<div style="display: flex; justify-content: space-between; align-items: center;">
				<div>
					<button class="btn btn-sm btn-primary" id="btn-select-all">Select All</button>
					<button class="btn btn-sm btn-default" id="btn-deselect-all">Deselect All</button>
					<span style="margin-left: 20px; font-weight: bold;">
						Total Rows: ${this.preview_data.total_rows}
					</span>
				</div>
				<button class="btn btn-success" id="btn-apply-selected">
					<i class="fa fa-check"></i> Import Selected
				</button>
			</div>
		`);

		controls.find('#btn-select-all').on('click', () => {
			this.$preview_section.find('.row-checkbox').prop('checked', true);
		});

		controls.find('#btn-deselect-all').on('click', () => {
			this.$preview_section.find('.row-checkbox').prop('checked', false);
		});

		controls.find('#btn-apply-selected').on('click', () => {
			this.apply_selected();
		});

		// Build inline edit table
		this.build_preview_table();
	}

	build_preview_table() {
		let table_wrapper = this.$preview_section.find('.preview-table');
		table_wrapper.empty();

		let html = `
			<div style="overflow-x: auto;">
				<table class="table table-bordered table-hover" style="font-size: 11px; min-width: 100%;">
					<thead>
						<tr style="background-color: #f8f9fa;">
							<th style="width: 30px;"><input type="checkbox" id="checkbox-all"></th>
							<th style="width: 40px;">Row</th>
							<th style="width: 90px;">Date</th>
							<th style="min-width: 200px;">Narration</th>
							<th style="width: 100px; text-align: right;">Amount</th>
							<th style="width: 150px;">Action</th>
							<th style="width: 120px;">Party Type</th>
							<th style="width: 150px;">Party/Account</th>
						</tr>
					</thead>
					<tbody>
		`;

		this.preview_data.preview_data.forEach((row, idx) => {
			let amount_class = flt(row.amount) >= 0 ? 'text-success' : 'text-danger';
			
			html += '<tr>';
			html += `<td><input type="checkbox" class="row-checkbox" data-idx="${idx}" checked></td>`;
			html += `<td>${row.row_no}</td>`;
			html += `<td>${row.posting_date || ''}</td>`;
			html += `<td title="${row.narration || ''}">${frappe.ellipsis(row.narration || '', 40)}</td>`;
			html += `<td style="text-align: right;" class="${amount_class}"><strong>${format_currency(row.amount)}</strong></td>`;
			
			// Action selector
			html += `<td>
				<select class="form-control input-xs action-select" data-idx="${idx}" style="font-size: 11px;">
					<option value="Auto" ${row.suggested_action === 'Auto' ? 'selected' : ''}>Auto</option>
					<option value="Payment Entry" ${row.suggested_action === 'Payment Entry' ? 'selected' : ''}>Payment Entry</option>
					<option value="Journal Entry" ${row.suggested_action === 'Journal Entry' ? 'selected' : ''}>Journal Entry</option>
					<option value="Internal Transfer" ${row.suggested_action === 'Internal Transfer' ? 'selected' : ''}>Cash Withdrawal</option>
					<option value="Ignore" ${row.suggested_action === 'Ignore' ? 'selected' : ''}>Skip</option>
				</select>
			</td>`;
			
			// Party Type selector
			html += `<td>
				<select class="form-control input-xs party-type-select" data-idx="${idx}" style="font-size: 11px;">
					<option value="">None</option>
					<option value="Customer">Customer</option>
					<option value="Supplier">Supplier</option>
				</select>
			</td>`;
			
			// Party/Account input
			html += `<td>
				<input type="text" class="form-control input-xs party-input" data-idx="${idx}" 
					placeholder="Optional" style="font-size: 11px;">
			</td>`;
			
			html += '</tr>';
		});

		html += '</tbody></table></div>';
		table_wrapper.html(html);

		// Bind checkbox all
		table_wrapper.find('#checkbox-all').on('change', function() {
			table_wrapper.find('.row-checkbox').prop('checked', $(this).is(':checked'));
		});

		// Bind action changes to update row data
		table_wrapper.find('.action-select').on('change', (e) => {
			let idx = $(e.target).data('idx');
			this.preview_data.preview_data[idx].suggested_action = $(e.target).val();
		});

		// Bind party type changes
		table_wrapper.find('.party-type-select').on('change', (e) => {
			let idx = $(e.target).data('idx');
			let row = this.preview_data.preview_data[idx];
			if (!row.config) row.config = {};
			row.config.party_type = $(e.target).val();
			
			// Show party input with link
			let $partyInput = table_wrapper.find(`.party-input[data-idx="${idx}"]`);
			this.setup_party_link($partyInput, $(e.target).val());
		});

		// Setup party inputs
		table_wrapper.find('.party-input').each((i, input) => {
			let idx = $(input).data('idx');
			$(input).on('change', (e) => {
				let row = this.preview_data.preview_data[idx];
				if (!row.config) row.config = {};
				row.config.party = $(e.target).val();
			});
		});
	}

	setup_party_link($input, party_type) {
		if (!party_type) {
			$input.attr('placeholder', 'Optional');
			return;
		}
		
		// Add awesomplete for party lookup
		$input.attr('placeholder', `Search ${party_type}...`);
		
		let awesomplete = new frappe.ui.form.LinkSelector({
			doctype: party_type,
			target: $input[0],
			txt: $input.val()
		});
	}

	apply_selected() {
		// Get selected rows
		let selected = [];
		let mappings = {};
		
		this.$preview_section.find('.row-checkbox:checked').each((i, checkbox) => {
			let idx = $(checkbox).data('idx');
			let row = this.preview_data.preview_data[idx];
			selected.push(idx);
			
			// Collect configuration
			if (row.config) {
				mappings[idx] = row.config;
			}
		});

		if (selected.length === 0) {
			frappe.msgprint(__('Please select at least one transaction'));
			return;
		}

		frappe.confirm(
			`Import ${selected.length} selected transactions?`,
			() => {
				frappe.show_alert({message: __('Importing transactions...'), indicator: 'blue'});
				
				frappe.call({
					method: 'bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file.apply_import',
					args: {
						import_doc_name: this.preview_data.import_doc_name,
						rows_json: JSON.stringify(selected),
						mapping_json: JSON.stringify(mappings)
					},
					callback: (r) => {
						if (r.message) {
							this.show_results(r.message);
						}
					}
				});
			}
		);
	}

	show_results(results) {
		this.$results_section.show();
		this.$preview_section.hide();

		let content = this.$results_section.find('.results-content');
		let indicator = results.success > 0 ? 'green' : (results.failed > 0 ? 'orange' : 'blue');
		
		let html = `
			<div class="alert alert-${indicator === 'green' ? 'success' : indicator === 'orange' ? 'warning' : 'info'}">
				<h4>Import Complete!</h4>
				<p>
					<strong>Success:</strong> ${results.success} transactions<br>
					<strong>Failed:</strong> ${results.failed} transactions<br>
					<strong>Ignored:</strong> ${results.ignored} transactions (duplicates)
				</p>
			</div>
		`;

		// Show created documents
		if (results.created_docs && results.created_docs.length > 0) {
			html += '<div style="margin-top: 20px;"><h5>Created Documents:</h5><ul>';
			results.created_docs.forEach(doc => {
				html += `<li><a href="/app/${doc.doctype.toLowerCase().replace(/ /g, '-')}/${doc.name}" target="_blank">
					${doc.doctype}: ${doc.name}
				</a></li>`;
			});
			html += '</ul></div>';
		}

		// Show errors/warnings
		if (results.errors && results.errors.length > 0) {
			html += '<div style="margin-top: 20px;"><h5>Messages:</h5><ul>';
			results.errors.forEach(err => {
				let badge_class = err.warning ? 'badge-warning' : 'badge-danger';
				html += `<li><span class="badge ${badge_class}">Row ${err.row}</span> ${err.error}</li>`;
			});
			html += '</ul></div>';
		}

		html += `
			<div style="margin-top: 20px;">
				<button class="btn btn-primary" id="btn-new-import">New Import</button>
				<button class="btn btn-default" id="btn-view-import-doc">View Import Document</button>
			</div>
		`;

		content.html(html);

		content.find('#btn-new-import').on('click', () => {
			this.reset_form();
		});

		content.find('#btn-view-import-doc').on('click', () => {
			frappe.set_route('Form', 'Bank Import File', this.preview_data.import_doc_name);
		});
	}
}
