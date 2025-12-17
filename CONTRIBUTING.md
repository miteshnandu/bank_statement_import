# Contributing to Bank Statement Import

Thank you for considering contributing to Bank Statement Import!

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your feature/fix
4. Make your changes
5. Test thoroughly
6. Submit a pull request

## Development Setup

```bash
# Get the app in development mode
cd frappe-bench
bench get-app /path/to/bank_statement_import

# Install on development site
bench --site dev.site install-app bank_statement_import

# Start development
bench start
```

## Testing

### Manual Testing

1. Upload various bank statement formats
2. Test with ICICI, Kotak, IDFC formats
3. Verify Dr/Cr detection
4. Test Payment Entry creation
5. Test Journal Entry creation
6. Verify duplicate prevention
7. Test with different naming series

### Bank Formats to Test

Create sample Excel files with these formats:

**ICICI Bank:**
```
Date | Narration | Value Date | Debit | Credit | Balance
```

**Kotak Bank:**
```
SN | Transaction ID | Transaction Date | Narration | Cheque No | Value Date | Debit | Credit | Balance
```

**IDFC First Bank:**
```
Transaction Date | Value Date | Particulars | Cheque No. | Debit | Credit | Balance
```

## Code Style

- Follow PEP 8 for Python code
- Use meaningful variable names
- Add docstrings to functions
- Keep functions focused and small
- Add comments for complex logic

## Pull Request Guidelines

### Before Submitting

- Ensure code is tested
- Update README.md if needed
- Add/update docstrings
- Follow existing code style
- No debug print statements

### PR Description

Include:
- What does this PR do?
- Why is this change needed?
- What testing was done?
- Any breaking changes?
- Screenshots (if UI changes)

## Reporting Bugs

When reporting bugs, include:

1. ERPNext version
2. Bank statement format
3. Steps to reproduce
4. Expected behavior
5. Actual behavior
6. Error messages/logs
7. Sample file (if possible, with sensitive data removed)

## Feature Requests

For new features, describe:

1. Use case
2. Expected behavior
3. Benefits
4. Any implementation ideas

## Code of Conduct

- Be respectful and professional
- Help others learn
- Accept constructive criticism
- Focus on what's best for the community

## Questions?

Feel free to open an issue for any questions or discussions.

Thank you for contributing! 🎉
