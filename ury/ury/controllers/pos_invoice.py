from erpnext.accounts.doctype.pos_invoice.pos_invoice import POSInvoice


class URYPOSInvoice(POSInvoice):
	"""URY is the only stock authority (Material Issue when the Pedido is created,
	reversal on cancel - see stock_deduction.py) and the business does no POS
	closing. ERPNext's own POS stock handling would run a second, conflicting model
	on top: re-checking availability as Bin minus every unclosed POS Invoice (each
	sale counted twice, so delivering the last units failed with "has no stock") and
	creating/submitting a Serial and Batch Bundle per batch row on submit
	(BatchNegativeStockError, since URY already took the batch out). So the POS
	Invoice is kept a pure sales/payment record."""

	def validate_stock_availablility(self):
		pass

	def validate_serialised_or_batched_item(self):
		pass

	def make_bundle_for_sales_purchase_return(self, *args, **kwargs):
		pass

	def make_bundle_using_old_serial_batch_fields(self, *args, **kwargs):
		pass

	def submit_serial_batch_bundle(self, *args, **kwargs):
		pass
