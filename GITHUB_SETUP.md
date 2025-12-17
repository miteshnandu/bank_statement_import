# GitHub Setup Instructions

## Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `bank_statement_import`
3. Description: "Bank Statement Import for ERPNext - Automate Payment Entry and Journal Entry creation"
4. Choose "Public"
5. **DO NOT** initialize with README (we already have one)
6. Click "Create repository"

## Push to GitHub

After creating the repository on GitHub, run these commands:

```bash
cd /home/frappe/frappe-bench/apps/bank_statement_import

# Add GitHub as remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/bank_statement_import.git

# Push to main/develop branch
git branch -M develop
git push -u origin develop

# Or if you want main branch:
# git branch -M main
# git push -u origin main
```

## After Pushing

### Add Repository Topics

On GitHub repository page, click "Add topics" and add:
- erpnext
- frappe
- bank-statement
- payment-entry
- journal-entry
- accounting
- automation
- indian-banks

### Enable Issues and Discussions

Go to Settings:
- Enable Issues
- Enable Discussions (optional)

### Add Repository Description

Add the description:
"Bank Statement Import for ERPNext - Automate Payment Entry and Journal Entry creation from Excel bank statements with support for ICICI, Kotak, IDFC and other Indian banks"

### Create Release

Once ready for v1.0.0:

```bash
git tag -a v1.0.0 -m "Release v1.0.0 - Initial release with multi-bank support"
git push origin v1.0.0
```

Then create a release on GitHub with release notes.

## Repository URL

After pushing, users can install with:

```bash
bench get-app https://github.com/YOUR_USERNAME/bank_statement_import.git
```

## Maintenance

### Update README

Update the installation command in README.md with your actual GitHub username.

### Set up Branch Protection

Consider protecting main/develop branch:
- Go to Settings → Branches
- Add branch protection rule
- Require pull request reviews

## Publishing to Frappe Marketplace (Optional)

To list on https://frappecloud.com/marketplace:

1. Ensure app has good documentation
2. Add screenshots/demo
3. Submit to marketplace
4. Follow marketplace guidelines

## Questions?

See CONTRIBUTING.md for development guidelines.
