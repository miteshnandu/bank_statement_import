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

		// Add CSS to prevent row wrapping in table cells
		$('<style>')
			.prop('type', 'text/css')
			.html(`
				.party-account-cell .form-group,
				.cost-center-cell .form-group {
					margin-bottom: 0 !important;
				}
				.party-account-cell .frappe-control,
				.cost-center-cell .frappe-control {
					margin-bottom: 0 !important;
				}
				.party-account-cell input,
				.cost-center-cell input {
					font-size: 9px !important;
					padding: 2px 4px !important;
					height: 26px !important;
					line-height: 22px !important;
				}
				.party-account-cell,
				.cost-center-cell {
					padding: 2px !important;
					vertical-align: middle !important;
				}
				.preview-table tbody tr {
					height: auto !important;
				}
			`)
			.appendTo('head');

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
					fieldtype: 'Section Break',
					label: __('Document Series')
				},
				{
					fieldtype: 'Select',
					fieldname: 'payment_entry_series',
					label: __('Payment Entry Series'),
					options: 'Loading...',  // Placeholder while loading
					reqd: 1
				},
				{
					fieldtype: 'Column Break'
				},
				{
					fieldtype: 'Select',
					fieldname: 'journal_entry_series',
					label: __('Journal Entry Series'),
					options: 'Loading...',  // Placeholder while loading
					reqd: 1
				},
				{
					fieldtype: 'Section Break'
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
		
		// Populate naming series dynamically
		this.load_naming_series();
	}
	
	load_naming_series() {
		// Fetch naming series from backend
		frappe.call({
			method: 'bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file.get_naming_series',
			callback: (r) => {
				if (r.message) {
					// Update Payment Entry series
					if (r.message.payment_entry_series && r.message.payment_entry_series.length > 0) {
						let field = this.upload_form.fields_dict.payment_entry_series;
						if (field) {
							field.df.options = r.message.payment_entry_series.join('\n');
							field.refresh();
							field.set_value(r.message.payment_entry_series[0]);
						}
					}
					
					// Update Journal Entry series
					if (r.message.journal_entry_series && r.message.journal_entry_series.length > 0) {
						let field = this.upload_form.fields_dict.journal_entry_series;
						if (field) {
							field.df.options = r.message.journal_entry_series.join('\n');
							field.refresh();
							field.set_value(r.message.journal_entry_series[0]);
						}
					}
				}
			}
		});
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
			<div style="overflow-x: auto; width: 100%;">
				<table class="table table-bordered table-hover" style="font-size: 10px; width: 100%; table-layout: fixed;">
					<thead>
						<tr style="background-color: #f8f9fa;">
							<th style="width: 2%;"><input type="checkbox" id="checkbox-all"></th>
							<th style="width: 3%;">Row</th>
							<th style="width: 8%;">Date</th>
							<th style="width: 25%;">Narration</th>
							<th style="width: 10%; text-align: right;">Amount</th>
							<th style="width: 12%;">Action</th>
							<th style="width: 10%;">Party Type</th>
							<th style="width: 18%;">Party/Account</th>
							<th style="width: 12%;">Cost Center</th>
						</tr>
					</thead>
					<tbody>
		`;

		this.preview_data.preview_data.forEach((row, idx) => {
			// Color based on Dr/Cr: Dr (debit/withdrawal) = red, Cr (credit/deposit) = green
			let amount_class = row.dr_cr_flag === 'Dr' ? 'text-danger' : 'text-success';
			let amount_badge = row.dr_cr_flag === 'Dr' ? 'badge-danger' : 'badge-success';
			
			html += '<tr style="height: 36px;">';
			html += `<td style="padding: 2px; vertical-align: middle;"><input type="checkbox" class="row-checkbox" data-idx="${idx}" checked></td>`;
			html += `<td style="padding: 2px; vertical-align: middle;">${row.row_no}</td>`;
			html += `<td style="padding: 2px; vertical-align: middle; font-size: 9px;">${row.posting_date || ''}</td>`;
			html += `<td title="${row.narration || ''}" style="padding: 2px; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px;">${row.narration || ''}</td>`;
			html += `<td style="padding: 2px; text-align: right; vertical-align: middle;">
				<strong style="font-size: 10px;" class="${amount_class}">${format_currency(row.amount)}</strong>
				<span class="badge ${amount_badge}" style="font-size: 8px; margin-left: 4px;">${row.dr_cr_flag || 'Dr'}</span>
			</td>`;
			
			// Action selector
			html += `<td style="padding: 2px; vertical-align: middle;">
				<select class="form-control input-xs action-select" data-idx="${idx}" style="font-size: 9px; padding: 2px 4px; height: 26px;">
					<option value="Payment Entry" ${row.suggested_action === 'Payment Entry' ? 'selected' : ''}>Payment Entry</option>
					<option value="Journal Entry" ${row.suggested_action === 'Journal Entry' ? 'selected' : ''}>Journal Entry</option>
					<option value="Internal Transfer" ${row.suggested_action === 'Internal Transfer' ? 'selected' : ''}>Cash Withdrawal</option>
					<option value="Ignore" ${row.suggested_action === 'Ignore' ? 'selected' : ''}>Skip</option>
				</select>
			</td>`;
			
			// Party Type selector
			html += `<td style="padding: 2px; vertical-align: middle;">
				<select class="form-control input-xs party-type-select" data-idx="${idx}" style="font-size: 9px; padding: 2px 4px; height: 26px;">
					<option value="">None</option>
					<option value="Customer">Customer</option>
					<option value="Supplier">Supplier</option>
				</select>
			</td>`;
			
			// Party/Account input
			html += `<td class="party-account-cell" data-idx="${idx}" style="padding: 2px; vertical-align: middle;">
				<input type="text" class="form-control input-xs party-input" data-idx="${idx}" 
					placeholder="Select party type first" disabled style="font-size: 9px; padding: 2px 4px; height: 26px;">
			</td>`;
			
			// Cost Center input
			html += `<td class="cost-center-cell" data-idx="${idx}" style="padding: 2px; vertical-align: middle;">
				<input type="text" class="form-control input-xs cost-center-input" data-idx="${idx}" 
					placeholder="Optional" style="font-size: 9px; padding: 2px 4px; height: 26px;">
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
			let action = $(e.target).val();
			this.preview_data.preview_data[idx].suggested_action = action;
			
			// If Journal Entry selected, switch party field to Account selector
			if (action === 'Journal Entry') {
				let $partyCell = table_wrapper.find(`.party-account-cell[data-idx="${idx}"]`);
				this.setup_account_link($partyCell, idx);
			} else {
				// For Payment Entry, use party type
				let party_type = table_wrapper.find(`.party-type-select[data-idx="${idx}"]`).val();
				if (party_type && party_type !== '') {
					let $partyCell = table_wrapper.find(`.party-account-cell[data-idx="${idx}"]`);
					this.setup_party_link($partyCell, party_type, idx);
				}
			}
		});

		// Bind party type changes
		table_wrapper.find('.party-type-select').on('change', (e) => {
			let idx = $(e.target).data('idx');
			let party_type = $(e.target).val();
			let row = this.preview_data.preview_data[idx];
			if (!row.config) row.config = {};
			row.config.party_type = party_type;
			
			// Enable/disable and setup party input - pass the TD cell
			let $partyCell = table_wrapper.find(`.party-account-cell[data-idx="${idx}"]`);
			this.setup_party_link($partyCell, party_type, idx);
		});

		// Initialize party inputs - set up autocomplete for pre-selected party types
		table_wrapper.find('.party-type-select').each((i, select) => {
			let idx = $(select).data('idx');
			let party_type = $(select).val();
			if (party_type && party_type !== '') {
				let $partyCell = table_wrapper.find(`.party-account-cell[data-idx="${idx}"]`);
				this.setup_party_link($partyCell, party_type, idx);
			}
		});

		// Setup cost center inputs with Link control
		table_wrapper.find('.cost-center-cell').each((i, cell) => {
			let idx = $(cell).data('idx');
			this.setup_cost_center_link($(cell), idx);
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

	/**
	 * Setup Cost Center Link control
	 */
	setup_cost_center_link($cell, row_index) {
		function dbg(...args) { try { console.debug("BankImport.setup_cost_center_link:", ...args); } catch(e){ } }
		dbg("called", { row_index, $cell_exists: !!$cell && $cell.length });

		const df = {
			fieldtype: 'Link',
			fieldname: `bank_import_cost_center_${row_index}`,
			label: 'Cost Center',
			options: 'Cost Center',
			reqd: 0
		};

		const $wrapper = $('<div class="bank-import-cc-wrapper"></div>');
		$cell.empty().append($wrapper);

		let control = null;
		try {
			control = frappe.ui.form.make_control({
				parent: $wrapper,
				df: df,
				only_input: true,
				render_input: true,
				with_label: false
			});
			if (control && typeof control.make_input === "function") {
				control.make_input();
			}
			dbg("Cost Center control created");
		} catch (err) {
			console.error("BankImport: failed to create cost center control:", err);
			const $fallback = $('<input type="text" class="form-control cost-center-input" placeholder="Optional">');
			$wrapper.append($fallback);
			return;
		}

		$cell.data('frappe_control', control);

		try {
			const $input = control.$input || $wrapper.find('input');
			if ($input && $input.length) {
				$input.on('change.bank_import awesomplete-selectcomplete', () => {
					let val = null;
					try {
						if (typeof control.get_value === 'function') {
							val = control.get_value();
						} else {
							val = $input.val();
						}
					} catch (e) {
						val = $input.val();
					}
					dbg("Cost Center changed to:", val, "for row_index:", row_index);
					if (this.preview_data && this.preview_data.preview_data && this.preview_data.preview_data[row_index]) {
						if (!this.preview_data.preview_data[row_index].config) {
							this.preview_data.preview_data[row_index].config = {};
						}
						this.preview_data.preview_data[row_index].config.cost_center = val;
					}
				});
			}
		} catch (err) {
			console.error("BankImport: wiring cost center change handler failed:", err);
		}

		dbg("setup_cost_center_link finished for row", row_index);
	}

	/**
	 * Setup Account Link control for Journal Entry
	 */
	setup_account_link($cell, row_index) {
		function dbg(...args) { try { console.debug("BankImport.setup_account_link:", ...args); } catch(e){ } }
		dbg("called", { row_index, $cell_exists: !!$cell && $cell.length });

		const df = {
			fieldtype: 'Link',
			fieldname: `bank_import_account_${row_index}`,
			label: 'Account',
			options: 'Account',
			reqd: 0,
			get_query: () => {
				return {
					filters: {
						'is_group': 0,
						'company': this.upload_form.get_value('company')
					}
				};
			}
		};

		const $wrapper = $('<div class="bank-import-account-wrapper"></div>');
		$cell.empty().append($wrapper);

		let control = null;
		try {
			control = frappe.ui.form.make_control({
				parent: $wrapper,
				df: df,
				only_input: true,
				render_input: true,
				with_label: false
			});
			if (control && typeof control.make_input === "function") {
				control.make_input();
			}
			dbg("Account control created");
		} catch (err) {
			console.error("BankImport: failed to create account control:", err);
			const $fallback = $('<input type="text" class="form-control party-input" placeholder="Select account">');
			$wrapper.append($fallback);
			return;
		}

		$cell.data('frappe_control', control);

		try {
			const $input = control.$input || $wrapper.find('input');
			if ($input && $input.length) {
				$input.on('change.bank_import awesomplete-selectcomplete', () => {
					let val = null;
					try {
						if (typeof control.get_value === 'function') {
							val = control.get_value();
						} else {
							val = $input.val();
						}
					} catch (e) {
						val = $input.val();
					}
					dbg("Account changed to:", val, "for row_index:", row_index);
					if (this.preview_data && this.preview_data.preview_data && this.preview_data.preview_data[row_index]) {
						if (!this.preview_data.preview_data[row_index].config) {
							this.preview_data.preview_data[row_index].config = {};
						}
						this.preview_data.preview_data[row_index].config.party = val;  // Store in party field
						this.preview_data.preview_data[row_index].config.account = val;
					}
				});
			}
		} catch (err) {
			console.error("BankImport: wiring account change handler failed:", err);
		}

		dbg("setup_account_link finished for row", row_index);
	}

	/**
	 * Robust setup_party_link: uses Frappe Link control (ControlLink or make_control),
	 * logs debug info, and falls back to an enabled text input if Link control fails.
	 *
	 * Params:
	 *  - $cell: jQuery element of the TD cell where the control should be rendered
	 *  - party_type: "Customer" or "Supplier" (string)
	 *  - row_index: integer index of the preview row (used to update preview_data / row_config)
	 */
	setup_party_link($cell, party_type, row_index) {
		function dbg(...args) { try { console.debug("BankImport.setup_party_link:", ...args); } catch(e){ } }
		dbg("called", { party_type, row_index, $cell_exists: !!$cell && $cell.length });

		// cleanup previous control
		try {
			const prev = $cell.data('frappe_control');
			if (prev) {
				dbg("Cleaning up previous control");
				if (prev.wrapper) prev.wrapper.remove();
				$cell.removeData('frappe_control');
			}
		} catch (err) {
			console.warn("BankImport.setup_party_link cleanup error:", err);
		}

		// placeholder when no party_type
		if (!party_type) {
			$cell.empty();
			const $txt = $('<input type="text" class="form-control party-input" disabled placeholder="Select party type first">');
			$cell.append($txt);
			dbg("Rendered disabled placeholder because party_type not provided");
			return;
		}

		const df = {
			fieldtype: 'Link',
			fieldname: `bank_import_party_${row_index || Math.floor(Math.random() * 100000)}`,
			label: 'Party',
			options: party_type,
			reqd: 0
		};

		const $wrapper = $('<div class="bank-import-link-wrapper"></div>');
		$cell.empty().append($wrapper);

		let control = null;
		try {
			if (frappe.ui.form && frappe.ui.form.ControlLink) {
				dbg("Attempting to instantiate frappe.ui.form.ControlLink");
				control = new frappe.ui.form.ControlLink({
					df: df,
					parent: $wrapper,
					render_input: true,
					only_input: true,
					with_label: false
				});
				if (typeof control.make_input === "function") {
					control.make_input();
				}
				dbg("ControlLink created");
			} else {
				dbg("ControlLink not available, trying make_control");
				control = frappe.ui.form.make_control({
					parent: $wrapper,
					df: df,
					only_input: true,
					render_input: true,
					with_label: false
				});
				if (control && typeof control.make_input === "function") {
					control.make_input();
				}
				dbg("make_control created");
			}
		} catch (err) {
			console.error("BankImport: failed to create link control:", err);
			$wrapper.empty();
			const $fallback = $('<input type="text" class="form-control party-input" placeholder="Type party name (will fuzzy-match on import)">');
			$wrapper.append($fallback);
			$fallback.on('change', () => {
				const val = $fallback.val();
				if (this.preview_data && this.preview_data.preview_data && this.preview_data.preview_data[row_index]) {
					this.preview_data.preview_data[row_index].party_name = val;
					if (!this.preview_data.preview_data[row_index].config) {
						this.preview_data.preview_data[row_index].config = {};
					}
					this.preview_data.preview_data[row_index].config.party = val;
					this.preview_data.preview_data[row_index].config.party_type = party_type;
				}
			});
			$cell.data('frappe_control', { wrapper: $wrapper, fallback: true });
			dbg("Rendered fallback text input due to control creation failure");
			return;
		}

		$cell.data('frappe_control', control);

		try {
			const existing_val = (this.preview_data && this.preview_data.preview_data && this.preview_data.preview_data[row_index] && this.preview_data.preview_data[row_index].party_name) || '';
			dbg("prefill existing value", existing_val);
			if (existing_val) {
				if (typeof control.set_input === 'function') {
					control.set_input(existing_val);
				} else if (typeof control.set_value === 'function') {
					control.set_value(existing_val);
				} else if (control.$input) {
					control.$input.val(existing_val);
				}
			}
		} catch (err) {
			console.warn("BankImport: prefill failed:", err);
		}

		try {
			const $input = control.$input || (control.input && control.input.$input) || $wrapper.find('input');
			if (!$input || !$input.length) {
				dbg("No underlying input element found for control - fallback to enabled text input");
				$wrapper.empty();
				const $fallback = $('<input type="text" class="form-control party-input" placeholder="Type party name (will fuzzy-match on import)">');
				$wrapper.append($fallback);
				$fallback.on('change', () => {
					const val = $fallback.val();
					if (this.preview_data && this.preview_data.preview_data && this.preview_data.preview_data[row_index]) {
						this.preview_data.preview_data[row_index].party_name = val;
						if (!this.preview_data.preview_data[row_index].config) {
							this.preview_data.preview_data[row_index].config = {};
						}
						this.preview_data.preview_data[row_index].config.party = val;
						this.preview_data.preview_data[row_index].config.party_type = party_type;
					}
				});
				$cell.data('frappe_control', { wrapper: $wrapper, fallback: true });
				return;
			}

			$input.on('change.bank_import', () => {
				let val = null;
				try {
					if (typeof control.get_value === 'function') {
						val = control.get_value();
					} else if (control.get_input_value) {
						val = control.get_input_value();
					} else {
						val = $input.val();
					}
				} catch (e) {
					val = $input.val();
				}
				dbg("Party changed to:", val, "for row_index:", row_index);
				if (this.preview_data && this.preview_data.preview_data && this.preview_data.preview_data[row_index]) {
					this.preview_data.preview_data[row_index].party_name = val;
					if (!this.preview_data.preview_data[row_index].config) {
						this.preview_data.preview_data[row_index].config = {};
					}
					this.preview_data.preview_data[row_index].config.party = val;
					this.preview_data.preview_data[row_index].config.party_type = party_type;
				}
			});

			// Also listen for awesomplete-selectcomplete which Frappe Link controls fire
			$input.on('awesomplete-selectcomplete', () => {
				let val = null;
				try {
					if (typeof control.get_value === 'function') {
						val = control.get_value();
					} else {
						val = $input.val();
					}
				} catch (e) {
					val = $input.val();
				}
				dbg("Party selected (awesomplete):", val, "for row_index:", row_index);
				if (this.preview_data && this.preview_data.preview_data && this.preview_data.preview_data[row_index]) {
					this.preview_data.preview_data[row_index].party_name = val;
					if (!this.preview_data.preview_data[row_index].config) {
						this.preview_data.preview_data[row_index].config = {};
					}
					this.preview_data.preview_data[row_index].config.party = val;
					this.preview_data.preview_data[row_index].config.party_type = party_type;
				}
			});

			try {
				$wrapper.on('click', '.btn-link, .link-control-trigger', () => {
					dbg("Link selector activated for row", row_index);
				});
			} catch (e) { /* ignore */ }

		} catch (err) {
			console.error("BankImport: wiring change handler failed:", err);
		}

		dbg("setup_party_link finished for row", row_index);
	}

	apply_selected() {
		// Get selected rows
		let selected = [];
		let mappings = {};
		
		this.$preview_section.find('.row-checkbox:checked').each((i, checkbox) => {
			let idx = $(checkbox).data('idx');
			let row = this.preview_data.preview_data[idx];
			selected.push(idx);
			
			// Collect current values from UI
			let config = {};
			
			// Get action first to determine what fields to collect
			let action = this.$preview_section.find(`.action-select[data-idx="${idx}"]`).val();
			
			// Always include action in config
			if (action) {
				config.action = action;
			}
			
			// Get party value - from preview_data.config which is updated by setup_party_link or setup_account_link
			let party = null;
			if (row.config && row.config.party) {
				party = row.config.party;
			}
			
			// Get party_type (declare outside if/else so it's available for logging)
			let party_type = null;
			
			if (action === 'Journal Entry') {
				// For Journal Entry, party field is actually the account
				if (party && party.trim() !== '') {
					config.account = party.trim();
				}
				// Don't set party_type for JE
			} else {
				// For Payment Entry, get party type and party
				party_type = this.$preview_section.find(`.party-type-select[data-idx="${idx}"]`).val();
				if (party_type && party_type !== '' && party_type !== 'None') {
					config.party_type = party_type;
				}
				if (party && party.trim() !== '') {
					config.party = party.trim();
				}
			}
			
			// Get cost center value from config
			if (row.config && row.config.cost_center) {
				config.cost_center = row.config.cost_center;
			}
			
			console.log(`Row ${idx}: action='${action}', party_type='${party_type}', party='${party}', cost_center='${row.config?.cost_center}', config=`, config);
			
			// Include existing config
			if (row.config) {
				config = Object.assign({}, row.config, config);
			}
			
			if (Object.keys(config).length > 0) {
				mappings[idx] = config;
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
				
				// Get series from upload form
				let series_config = {
					payment_entry_series: this.upload_form.get_value('payment_entry_series'),
					journal_entry_series: this.upload_form.get_value('journal_entry_series')
				};
				
				console.log('DEBUG: Full mappings being sent:', JSON.stringify(mappings, null, 2));
				console.log('DEBUG: Selected rows:', selected);
				console.log('DEBUG: Import doc name:', this.preview_data.import_doc_name);
				console.log('DEBUG: Series config:', series_config);
				
				frappe.call({
					method: 'bank_statement_import.bank_statement_import.doctype.bank_import_file.bank_import_file.apply_import',
					args: {
						import_doc_name: this.preview_data.import_doc_name,
						rows_json: JSON.stringify(selected),
						mapping_json: JSON.stringify(mappings),
						series_config: JSON.stringify(series_config)
					},
					callback: (r) => {
						console.log('DEBUG: Server response:', r);
						console.log('DEBUG: r.message:', r.message);
						
						if (r.message && r.message.success) {
							// Show success notification
							let summary = r.message.summary;
							console.log('DEBUG: Summary:', summary);
							let msg = `Successfully imported ${summary.success} transaction(s)`;
							if (summary.failed > 0) {
								msg += `, ${summary.failed} failed`;
							}
							if (summary.ignored > 0) {
								msg += `, ${summary.ignored} ignored (duplicates)`;
							}
							frappe.show_alert({
								message: msg,
								indicator: summary.failed > 0 ? 'orange' : 'green'
							}, 7);
							this.show_results(summary);
						} else if (r.message && !r.message.success) {
							// Show error
							console.log('DEBUG: Error from server:', r.message.error);
							frappe.show_alert({
								message: __('Import failed: ') + (r.message.error || 'Unknown error'),
								indicator: 'red'
							}, 7);
						} else {
							console.log('DEBUG: Unexpected response structure');
							frappe.show_alert({
								message: __('Import completed but no results returned'),
								indicator: 'orange'
							}, 5);
						}
					},
					error: (r) => {
						console.log('DEBUG: Error callback triggered:', r);
						frappe.show_alert({
							message: __('Import failed: ') + (r.message || 'Server error'),
							indicator: 'red'
						}, 7);
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
