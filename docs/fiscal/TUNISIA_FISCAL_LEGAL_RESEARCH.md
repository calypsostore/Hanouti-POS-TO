# Tunisia Fiscal Legal Research for Hanouti POS

Research snapshot: 2026-11-25  
Scope: general retail, cafes/restaurants, and service businesses using a POS.  
This is technical product research, not personalized tax or legal advice.

## Research method and confidence

Official Ministry of Finance pages and an official Ministry-hosted 2026 Finance Law PDF were reviewed. The Ministry's code collection page links a 2017 compilation of several tax codes. That compilation is useful for identifying the governing instruments but is not a consolidated current code. The complete JORT PDF is 101 pages; text extraction available in this environment verified only the searchable early pages, while later pages are image/scanned content. Therefore no unverified provision, rate, deadline, invoice scope, or e-invoicing mandate is activated in the software.

Legal status in the matrix is explicitly separated from implementation status. Store configuration is a business record, not an automated legal opinion. An accountant or Tunisian tax professional must validate the current consolidated rules applicable to each store before configuration is used for statutory declarations or tax invoicing.

## Primary official sources reviewed

1. Tunisian Ministry of Finance, *Cadre reglementaire - Recueils des textes fiscaux*:  
   https://www.finances.gov.tn/fr/cadre-reglementaire-6  
   This page identifies the principal codes and links to Ministry-hosted compilations. It identifies:
   - Code de la TVA: Law No. 88-61 of 2 June 1988.
   - Droit de consommation: Law No. 88-62 of 2 June 1988.
   - IRPP/IS Code: Law No. 89-114 of 30 December 1989.
   - Registration and stamp-duty Code: Law No. 93-53 of 17 May 1993.
   - Local-taxation Code: Law No. 97-11 of 3 February 1997.
   - Tax Rights and Procedures Code: Law No. 2000-82 of 9 August 2000.
   The linked VAT/consumption-duty compilation is labelled 2017:  
   https://www.finances.gov.tn/sites/default/files/CODE%20TVA%202017%20FR.pdf

2. Ministry of Finance, *E-services*:  
   https://www.finances.gov.tn/fr/e-services  
   The Ministry lists tax e-services including e-declaration, e-payment/liquidation, e-stamp, fiscal-status services, and a TEJ platform link. The listing proves an official service exists; it does not, by itself, establish which private businesses must use it, applicable transaction coverage, schemas, signatures, or certification rules.

3. Ministry of Finance, *FAQ*:  
   https://www.finances.gov.tn/fr/faq  
   The reviewed FAQ references paragraph III of Article 18 of the VAT Code for the goods-out document (bon de sortie) and describes its required nature/quantity, issue date, and vehicle registration details. It also gives examples of withholding and income-tax answers for specific taxpayer/transaction circumstances. Those examples are not universal POS rates.

4. Ministry of Finance, *Loi des finances pour l'annee 2026 (Ar)*, document listing:  
   https://www.finances.gov.tn/fr/telechargement  
   Direct PDF hosted by the Ministry:  
   https://www.finances.gov.tn/sites/default/files/2026-01/115725.pdf  
   The PDF cover/extracted text identifies Law No. 17 of 2025, dated 12 December 2025, published in JORT issue 148 dated 12 December 2025. The official PDF is in Arabic. The following provisions were readable in extracted pages and should still be checked against the official Arabic text and any subsequent amendments before being operationalized:
   - Articles 16-17 provide VAT suspension/exemption for specified medical-entity purchases/equipment. These are entity- and use-specific, not ordinary retail defaults.
   - Article 46 provides a 7% VAT treatment and customs exemption for listed imported inputs used to manufacture lithium batteries, subject to a Ministry of Industry-endorsed annual program. It is not a general 7% product rate.
   - Article 47 contains specific vehicle-related excise/VAT changes.
   - Article 18 amends registration/stamp-duty provisions, including a new Article 117(I)(6 bis) stamp-duty entry for invoices issued by defined large commercial areas: the extracted text states invoice-value bands of TND 50-100 and over TND 100 and amounts printed as TND 1.500 and TND 2.000 per invoice. This narrow scope must not be generalized to all stores or products. The exact legal definition, boundary handling, currency punctuation, and effective date need a qualified review of the authoritative Arabic clause.

## Requirement findings

### VAT and consumption duty

The governing statutes are the VAT Code (Law 88-61) and consumption-duty law (Law 88-62), as identified by the Ministry's code page. The Ministry-hosted compilation is dated 2017 and cannot establish every currently applicable amendment/rate. VAT treatment depends on the operation, item, exemption/suspension, and taxpayer status. Consumption duty is a separate tax regime and cannot be inferred to apply to every POS item. No statutory rate table is preloaded. Owners may record draft/configured rules, but activation for statutory use requires confirmation against current consolidated law.

The 2026 law's Articles 16, 17, 46, and 47 demonstrate targeted exemptions or special treatments. They are evidence against a universal hard-coded rate. Product-level law and supporting evidence must be retained for special treatments.

### Invoices, receipts, and stamp duties

The Ministry FAQ cites VAT Code Article 18, paragraph III, for the contents of a goods-out document. The Ministry-hosted 2026 law adds a narrow stamp-duty rule described above for defined large commercial areas. These sources do not establish that every Hanouti ticket is a statutory invoice, or that all stores owe the new invoice stamp. Required invoice fields, invoice issuance scope, numbering, retention, credit notes, and exemptions need current article-by-article review of the consolidated VAT and registration/stamp-duty Codes and their amendments.

### IRPP, IS, and fiscal regimes

The Ministry identifies the IRPP/IS Code (Law 89-114). These are taxpayer/business-level obligations, not automatically a checkout tax. The Ministry FAQ illustrates regime-dependent declarations and exceptions. Sales totals alone cannot determine a final IRPP/IS liability. The product should provide evidence-based reports and exportable summaries, not assert a final tax due.

### Withholding

The Ministry FAQ gives a specific 0.5% example for payments of at least TND 1,000 for services necessary to the activity of a totally exporting company. That fact pattern is narrow; it is not an ordinary consumer-sale rule. Withholding requires counterparty, payment, transaction, threshold, and taxpayer-regime conditions, plus certificate and reporting records. Do not apply it to a normal retail order by default.

### E-invoicing

The Ministry E-services page links the TEJ platform and e-declaration/e-payment services. The pages reviewed do not identify the legal universe of mandatory e-invoicing users, transaction types, effective dates, current technical format, signing/authentication rules, archiving rules, or authorized-provider requirements. The extracted text from the readable portion of the 2026 law did not verify an e-invoicing scope change, and the later scanned pages could not be text-searched. Therefore these questions are **unverified**. No integration may claim official connection or legal compliance until the current legal text, technical specifications, provider authorization, and test/approval requirements are independently confirmed.

### Certified cash registers / fiscal devices

No primary official source reviewed established the activities, deadlines, device approvals, fiscal-storage/QR requirements, or certification path applicable to these Hanouti store categories. This remains unverified. A normal app-generated ticket must not be represented as a certified fiscal receipt.

### Effective dates and amendments

The Ministry-hosted LF2026 PDF establishes publication in JORT issue 148 on 12 December 2025 and the law is dated 12 December 2025. The final effective-date clauses are on scanned pages not text-extracted in this review, and the legal effect of each amended provision was not independently confirmed. Do not infer a blanket effective date from the publication date. Review the Arabic source and any later amendments before activation.

## Software safety decisions derived from this research

- No default tax rates or legal status are assigned to a store, category, product, or transaction.
- Tax profiles and tax rules can be stored as draft/configuration with legal references and effective dates; missing or conflicting rules must be surfaced, not silently guessed.
- A tax calculation result is not a declaration, tax opinion, invoice certification, or proof of filing.
- Exemptions/suspensions require an explicit scope and documentary evidence; never infer one from a product name/category.
- E-invoice/certified-device functionality remains an integration boundary, not a simulated compliance claim.
- Keep applicable legal version/source, reviewer, and validation status with each configured rule.

## Unresolved legal review required before production tax activation

1. Current consolidated versions and amendments to the VAT Code, consumption-duty law, registration/stamp-duty Code, IRPP/IS Code, and Tax Rights and Procedures Code.
2. Applicable rates, taxable bases, rounding, credit/refund treatment, invoice conditions, and tax-reporting periods by legal regime and product/activity.
3. Full Arabic LF2026 text review, including Article 18's invoice stamp scope/thresholds/effective date and final effectiveness clauses.
4. E-invoicing mandate, applicability, format, signatures, providers, test approvals, archiving, and 2026 amendments.
5. Certified fiscal device obligations and timelines by business type.
6. Accountant/legal review of store-specific configuration before statutory use.

## Research conclusion

The official sources establish the governing code families and confirm that the 2026 law includes highly specific tax measures. They do **not** justify a one-size-fits-all checkout tax or a compliance claim for Hanouti. It is safe to proceed with a configurable, versioned fiscal framework only if unverified rules remain inactive and visible as requiring professional validation.
