# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class URYCupom(Document):
	def validate(self):
		# Codes are looked up case-insensitively at apply time (see
		# ury.ury.api.cupom) - normalizing to uppercase here is what makes
		# "queima10" and "QUEIMA10" the same Cupom instead of two unrelated
		# ones a Dono could accidentally create.
		if self.codigo:
			self.codigo = self.codigo.strip().upper()

		if self.valido_de and self.valido_ate and getdate(self.valido_de) > getdate(self.valido_ate):
			frappe.throw(_("“Válido de” não pode ser depois de “Válido até”."))

		if self.tipo_desconto == "Percentual" and self.valor and self.valor > 100:
			frappe.throw(_("Um Cupom percentual não pode passar de 100."))
