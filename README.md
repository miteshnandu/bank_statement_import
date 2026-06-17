# Bank Statement Import for ERPNext

Automate Payment Entry and Journal Entry creation from bank statement Excel files.

## Features

- 📊 **Multi-Bank Support**: Works with ICICI Bank, Kotak Bank, IDFC First Bank, DCB Bank, and more
- 🎯 **Smart Detection**: Auto-detects debit/credit transactions
- 🔄 **Flexible Actions**: Create Payment Entry or Journal Entry
- 👥 **Party Mapping**: Select Customer/Supplier for each transaction
- 💰 **Cost Center**: Assign cost centers to transactions
- 🎨 **Color Coding**: Visual distinction between debit (red) and credit (green)
- 📝 **Narration Support**: Uses transaction description as reference
- 🔢 **Series Selection**: Choose document naming series
- 🚫 **Duplicate Prevention**: Avoids importing same transactions twice

## Supported Bank Formats

The app intelligently parses multiple bank statement formats:

### ICICI Bank
Columns: Date, Narration, Value Date, Debit, Credit, Balance, etc.

### Kotak Bank
Columns: SN, Transaction ID, Transaction Date, Narration, Cheque No, Value Date, Debit, Credit, Balance

### IDFC First Bank
Columns: Transaction Date, Value Date, Particulars, Cheque No., Debit, Credit, Balance

### DCB Bank
Columns: Date, Transaction Details, Cheque Number, Withdrawals, Deposits, Balance

### Other Banks
The flexible parser can handle most Indian bank statement formats with common columns like:
- Date/Transaction Date/Posting Date
- Narration/Description/Particulars/Transaction Details
- Debit/Credit or Withdrawals/Deposits or Dr/Cr columns
- Amount column (for single column format)
- Cheque No/Reference/UTR

## Installation

### Prerequisites
- ERPNext v14 or v15
- Python 3.10+
- Required Python packages: pandas, openpyxl

### Install via Bench

```bash
# Get the app
cd frappe-bench
bench get-app https://github.com/miteshnandu/bank_statement_import.git

# Install on your site
bench --site your-site-name install-app bank_statement_import

# Migrate
bench --site your-site-name migrate

# Restart
bench restart
```

## Usage

### 1. Access Bank Statement Import

Navigate to: **Accounting → Bank Statement Import**

Or search for "Bank Statement Import" in the awesomebar.

### 2. Upload Bank Statement

1. **Select Company**: Choose your company
2. **Select Bank Account**: Choose the bank account from which statement is being imported
3. **Choose Series**: Select naming series for Payment Entry and Journal Entry
4. **Upload File**: Attach Excel (.xlsx or .xls) file
5. Click **Upload & Parse**

### 3. Review Transactions

The app will parse and display all transactions with:
- Date and narration
- Amount with color coding (Red for debit, Green for credit)
- Suggested action (Payment Entry or Journal Entry)

### 4. Configure Transactions

For each transaction:
- **Action**: Choose Payment Entry or Journal Entry
- **Party Type**: Select Customer or Supplier (for Payment Entry)
- **Party/Account**: Select the party name or account
- **Cost Center**: Optionally assign a cost center

### 5. Import Selected

1. Select transactions using checkboxes
2. Click **Import Selected**
3. Review the results summary

## Custom Fields

The app automatically creates custom fields on Payment Entry and Journal Entry:
- `bank_import_reference`: For duplicate prevention
- Links to parent Bank Import File document

## Configuration

### Bank Import Mapping (Optional)

Create mapping rules for automatic party/account suggestion:

1. Go to **Bank Import Mapping** list
2. Create new mapping with:
   - Pattern to match in narration
   - Target party type and party
   - Or target account for Journal Entry
   - Priority (lower number = higher priority)

## Troubleshooting

### Transactions showing wrong Dr/Cr

The app determines debit/credit from:
1. Explicit Dr/Cr column in the statement
2. Separate Debit and Credit columns
3. Default to Debit if unclear

If issues persist, check the Excel file column headers.

### Import fails

- Ensure Excel file is not password protected
- Check that date columns have proper date format
- Verify amount columns contain numbers, not text

### Duplicate entries

The app uses a combination of reference number, amount, and date to prevent duplicates. If you need to reimport, check the Bank Import File document status.

## Development

### Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

### Code Structure

```
bank_statement_import/
├── bank_statement_import/
│   ├── doctype/
│   │   ├── bank_import_file/       # Main import document
│   │   ├── bank_import_row/        # Child table for rows
│   │   └── bank_import_mapping/    # Optional mapping rules
│   └── page/
│       └── bank_import_page/       # Main UI page
└── hooks.py
```

### Key Functions

- `parse_bank_sheet()`: Parses Excel file and detects format
- `determine_dr_cr()`: Identifies debit/credit transactions
- `create_payment_entry()`: Creates Payment Entry document
- `create_journal_entry()`: Creates Journal Entry document

## License

AGPL-3.0

## Support

For issues and feature requests, please use [GitHub Issues](https://github.com/miteshnandu/bank_statement_import/issues).

## Credits

Developed by Mitesh Nandu for the ERPNext community.
