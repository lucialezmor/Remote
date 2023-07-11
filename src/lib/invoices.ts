import { BitcoinDenomination, FiatDenomination } from './@types/settings.js'
import type { DecodedInvoice, FormattedDecodedBolt11 } from './@types/invoices.js'
import { decode as bolt11Decoder } from 'light-bolt11-decoder'
import type { Offer } from './@types/offers.js'

import type {
  DecodedBolt12Invoice,
  DecodedBolt12InvoiceRequest,
  DecodedBolt12Offer,
  DecodedType
} from 'bolt12-decoder/@types/types.js'

export function decodeBolt11(bolt11: string): (FormattedDecodedBolt11 & { bolt11: string }) | null {
  // Remove prepended string if found
  if (bolt11.includes('lightning:')) {
    bolt11 = bolt11.replace('lightning:', '')
  }

  try {
    const { sections } = bolt11Decoder(bolt11) as DecodedInvoice

    const formatted = sections.reduce((acc, { name, value }) => {
      if (name && value) {
        acc[name] = value
      }

      return acc
    }, {} as FormattedDecodedBolt11)

    return { bolt11, ...formatted }
  } catch (error) {
    return null
  }
}

export async function bolt12ToOffer(bolt12: string, offerId?: string): Promise<Offer> {
  const { default: decoder } = await import('bolt12-decoder')
  const decoded = decoder(bolt12)

  const {
    type,
    offer_currency,
    offer_amount,
    offer_description,
    offer_node_id,
    offer_issuer,
    offer_absolute_expiry,
    offer_quantity_max
  } = decoded

  const expiry = offer_absolute_expiry
  const description = offer_description
  const issuer = offer_issuer

  let denomination: BitcoinDenomination.msats | FiatDenomination
  let nodeId: string
  let quantityMax: number | undefined
  let amount: string
  let id = offerId || ''

  if (type === 'bolt12 invoice_request') {
    const { invreq_amount, invreq_payer_id, invreq_id } = decoded as DecodedBolt12InvoiceRequest
    denomination = BitcoinDenomination.msats
    amount = invreq_amount as string
    nodeId = invreq_payer_id
    quantityMax = offer_quantity_max
    id = invreq_id
  } else {
    const { invreq_amount } = decoded as DecodedBolt12Invoice
    const { offer_id } = decoded as DecodedBolt12Offer
    denomination = (offer_currency?.toLowerCase() as FiatDenomination) || BitcoinDenomination.msats
    amount = (offer_amount || invreq_amount) as string
    nodeId = offer_node_id
    quantityMax = offer_quantity_max
    id = offer_id || id
  }

  return {
    id,
    bolt12,
    type: decodedOfferTypeToOfferType(type),
    expiry,
    description,
    issuer,
    denomination,
    amount,
    nodeId,
    quantityMax
  }
}

export function isBolt12Invoice(invoice: string): boolean {
  return invoice.toLowerCase().startsWith('lni')
}

export function decodedOfferTypeToOfferType(type: DecodedType): 'pay' | 'withdraw' {
  if (type === 'bolt12 invoice_request') {
    return 'withdraw'
  } else {
    return 'pay'
  }
}
