import { useState } from 'react'
import { formatCurrency } from '@ury/core'
import { useOrderingSession } from '../hooks/useOrderingSession'
import { lookupDeliveryCustomer, type OrderingContext } from '../lib/api'
import { t } from '../i18n'

interface LayoutProps {
  initialContext?: OrderingContext
}

// Loose digit-count check (DDD + number, with or without the 9), not a
// full phone validator — the backend (validate_phone_number) is the real
// gate. This just decides when a lookup is worth firing.
const MIN_PHONE_DIGITS = 10

function MobileQRLayout({ initialContext }: LayoutProps) {
  const {
    context,
    menu,
    order,
    cart,
    loading,
    submitting,
    error,
    billRequested,
    paymentRequest,
    payingOnline,
    savingDelivery,
    applyingCoupon,
    couponError,
    addToCart,
    decrementCart,
    submitCart,
    handleRequestBill,
    payOnline,
    submitDeliveryDetails,
    applyCoupon,
    resetSession,
    cartItems,
    cartCount,
    cartTotal,
  } = useOrderingSession(initialContext)

  const [couponCode, setCouponCode] = useState('')
  const [deliveryName, setDeliveryName] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryPhone, setDeliveryPhone] = useState('')
  const [lookingUpAddress, setLookingUpAddress] = useState(false)
  const [savedAddressFound, setSavedAddressFound] = useState(false)
  const [orderNotes, setOrderNotes] = useState('')

  // Fires once the phone field looks complete enough to be worth a lookup.
  // Only prefills fields that are still empty — never clobbers something
  // the customer already started typing.
  async function handlePhoneBlur() {
    const digits = deliveryPhone.replace(/\D/g, '')
    if (digits.length < MIN_PHONE_DIGITS || !context) return
    if (deliveryAddress.trim() && deliveryName.trim()) return
    setLookingUpAddress(true)
    try {
      const result = await lookupDeliveryCustomer(context.session, deliveryPhone.trim())
      if (result.found) {
        if (result.address && !deliveryAddress.trim()) setDeliveryAddress(result.address)
        if (result.name && !deliveryName.trim()) setDeliveryName(result.name)
        setSavedAddressFound(true)
      }
    } catch {
      // Best-effort convenience lookup — a failure here shouldn't block the
      // customer from just typing their details manually.
    } finally {
      setLookingUpAddress(false)
    }
  }

  function handleSaveDeliveryDetails(event: React.FormEvent) {
    event.preventDefault()
    if (!deliveryName.trim() || !deliveryAddress.trim() || !deliveryPhone.trim()) return
    submitDeliveryDetails(deliveryAddress.trim(), deliveryPhone.trim(), deliveryName.trim())
  }

  function handleStartOver() {
    if (window.confirm(t('confirm.start_over'))) {
      resetSession()
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        {t('common.loading_menu')}
      </div>
    )
  }

  if (error && !context) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-destructive">
        {error}
      </div>
    )
  }

  // `source` (not the absence of a table) is the authoritative signal for
  // pickup mode — set server-side by _verify_qr_token/_resolve_device, never
  // guessed from context.table being falsy.
  const isPickup = context?.source === 'QR Pickup'
  const isDelivery = context?.source === 'Delivery'
  const deliveryDetailsSaved = Boolean(order?.delivery_address)

  return (
    <div className="min-h-screen pb-28">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          {context?.logo_url && (
            <img src={context.logo_url} alt="Logo" className="h-8 w-8 shrink-0 rounded object-contain" />
          )}
          <h1 className="truncate text-lg font-semibold">
            {isPickup
              ? t('common.order_for_pickup')
              : isDelivery
                ? t('common.order_for_delivery')
                : context?.table
                  ? t('common.table_label', { table: context.table })
                  : t('common.order_fallback_title')}
          </h1>
        </div>
        <button
          onClick={handleStartOver}
          className="rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground"
        >
          {t('common.start_over')}
        </button>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {isDelivery && (
        <section className="mx-4 mt-4 rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t('delivery.heading')}</h2>
          {deliveryDetailsSaved ? (
            <div className="text-sm">
              <p className="font-medium">{order!.delivery_name}</p>
              <p className="text-muted-foreground">{order!.delivery_address}</p>
            </div>
          ) : (
            <form onSubmit={handleSaveDeliveryDetails} className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                {t('delivery.name_label')}
                <input
                  type="text"
                  value={deliveryName}
                  onChange={(event) => {
                    setDeliveryName(event.target.value)
                    setSavedAddressFound(false)
                  }}
                  placeholder={t('delivery.name_placeholder')}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                {t('delivery.phone_label')}
                <input
                  type="tel"
                  value={deliveryPhone}
                  onChange={(event) => {
                    setDeliveryPhone(event.target.value)
                    setSavedAddressFound(false)
                  }}
                  onBlur={handlePhoneBlur}
                  placeholder={t('delivery.phone_placeholder')}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                {t('delivery.address_label')}
                <textarea
                  value={deliveryAddress}
                  onChange={(event) => {
                    setDeliveryAddress(event.target.value)
                    setSavedAddressFound(false)
                  }}
                  placeholder={lookingUpAddress ? t('delivery.looking_up') : t('delivery.address_placeholder')}
                  rows={2}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-foreground"
                />
              </label>
              {savedAddressFound && (
                <p className="text-xs text-muted-foreground">{t('delivery.saved_address_found')}</p>
              )}
              <button
                type="submit"
                disabled={savingDelivery || !deliveryName.trim() || !deliveryAddress.trim() || !deliveryPhone.trim()}
                className="mt-1 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {savingDelivery ? t('delivery.saving') : t('delivery.save_button')}
              </button>
            </form>
          )}
        </section>
      )}

      {order && order.items.length > 0 && (
        <section className="mx-4 mt-4 rounded-lg border p-3">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t('order_summary.heading')}</h2>
          {isPickup && order.pickup_code && (
            <p className="mb-2 rounded-md bg-muted p-2 text-center text-sm font-semibold">
              {t('order_summary.pickup_code', { code: order.pickup_code })}
            </p>
          )}
          <ul className="space-y-1 text-sm">
            {order.items.map((row, idx) => (
              <li key={`${row.item_code}-${idx}`} className="flex justify-between">
                <span>{row.item_name} × {row.qty}</span>
                <span>{row.amount}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold">
            <span>{t('common.total')}</span>
            <span>{order.grand_total}</span>
          </div>
          {!order.billed && (
            <div className="mt-3">
              {order.coupon_code ? (
                <div className="flex items-center justify-between rounded-md bg-muted p-2 text-sm">
                  <span className="font-medium">{t('coupon.applied', { code: order.coupon_code })}</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(event) => setCouponCode(event.target.value)}
                    placeholder={t('coupon.placeholder')}
                    className="flex-1 rounded-md border px-3 py-2 text-sm text-foreground"
                    disabled={applyingCoupon}
                  />
                  <button
                    onClick={() => applyCoupon(couponCode.trim())}
                    disabled={applyingCoupon || !couponCode.trim()}
                    className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {applyingCoupon ? t('coupon.applying') : t('coupon.apply_button')}
                  </button>
                </div>
              )}
              {couponError && <p className="mt-1 text-xs text-destructive">{couponError}</p>}
            </div>
          )}
          {context?.capabilities.customer_payment_enabled && !order.billed && (
            <button
              className="mt-3 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={payingOnline}
              onClick={payOnline}
            >
              {payingOnline ? t('common.starting_payment') : t('common.pay_online')}
            </button>
          )}
          {paymentRequest && !paymentRequest.payment_url && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('payment.pending_notice', {
                amount: paymentRequest.amount,
                currency: paymentRequest.currency,
              })}
            </p>
          )}
          {!isPickup && context?.capabilities.request_bill_enabled && !order.billed && (
            <button
              className="mt-3 w-full rounded-md border py-2 text-sm font-medium disabled:opacity-50"
              disabled={billRequested}
              onClick={handleRequestBill}
            >
              {billRequested ? t('common.bill_requested') : t('common.request_bill')}
            </button>
          )}
        </section>
      )}

      <section className="mx-4 mt-4 grid grid-cols-2 gap-3">
        {menu.map((item) => (
          <button
            key={item.item}
            onClick={() => !item.sold_out && addToCart(item)}
            disabled={Boolean(item.sold_out)}
            className="flex flex-col overflow-hidden rounded-lg border text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {context?.capabilities.show_item_images && item.item_image && (
              <img src={item.item_image} alt={item.item_name} className="h-24 w-full object-cover" />
            )}
            <div className="p-2">
              <div className="text-sm font-medium">{item.item_name}</div>
              {item.sold_out ? (
                <div className="text-sm font-medium text-destructive">{t('common.sold_out')}</div>
              ) : (
                <div className="text-sm text-muted-foreground tabular-nums">{formatCurrency(item.rate)}</div>
              )}
              {cart[item.item] && (
                <div className="mt-1 text-xs font-semibold text-primary">
                  {t('common.in_cart', { qty: cart[item.item].qty })}
                </div>
              )}
            </div>
          </button>
        ))}
      </section>

      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-background p-4">
          <ul className="mb-2 max-h-32 space-y-1 overflow-y-auto text-sm">
            {cartItems.map((entry) => (
              <li key={entry.item.item} className="flex items-center justify-between">
                <span>{entry.item.item_name}</span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => decrementCart(entry.item.item)}
                    className="h-6 w-6 rounded-full border text-xs leading-none"
                    aria-label={t('common.remove_one', { item: entry.item.item_name })}
                  >
                    −
                  </button>
                  {entry.qty}
                  <button
                    onClick={() => addToCart(entry.item)}
                    className="h-6 w-6 rounded-full border text-xs leading-none"
                    aria-label={t('common.add_one_more', { item: entry.item.item_name })}
                  >
                    +
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <textarea
            value={orderNotes}
            onChange={(event) => setOrderNotes(event.target.value)}
            placeholder={t('common.order_notes_placeholder')}
            rows={2}
            className="mb-2 w-full rounded-md border px-3 py-2 text-sm text-foreground"
          />
          <div className="mb-2 flex items-center justify-between text-sm font-semibold">
            <span>
              {cartCount === 1
                ? t('common.item_count_one', { count: cartCount })
                : t('common.item_count_other', { count: cartCount })}
            </span>
            <span className="tabular-nums">{formatCurrency(cartTotal)}</span>
          </div>
          <button
            onClick={() => submitCart(orderNotes.trim() || undefined)}
            disabled={submitting || (isDelivery && !deliveryDetailsSaved)}
            className="w-full rounded-md bg-primary py-3 font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting ? t('common.placing_order') : t('common.place_order')}
          </button>
        </div>
      )}
    </div>
  )
}

export default MobileQRLayout
