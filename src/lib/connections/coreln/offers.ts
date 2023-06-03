import { bolt12ToOffer, formatMsat, nowSeconds } from '$lib/utils.js'
import type { Invoice } from '$lib/@types/invoices.js'
import { invoiceStatusToPaymentStatus } from './utils.js'
import { BitcoinDenomination } from '$lib/@types/settings.js'
import type { OffersInterface } from '../interfaces.js'

import type {
  CreatePayOfferOptions,
  CreateWithdrawOfferOptions,
  Offer,
  FetchInvoiceOptions,
  SendInvoiceOptions
} from '$lib/@types/offers.js'

import type {
  CorelnConnectionInterface,
  CoreLnError,
  CreatePayOfferResponse,
  CreateWithdrawOfferResponse,
  FetchInvoiceResponse,
  InvoiceRequestSummary,
  InvoiceStatus,
  ListInvoiceRequestsResponse,
  ListOffersResponse,
  OfferSummary,
  SendInvoiceResponse
} from './types.js'
import handleError from './error.js'

class Offers implements OffersInterface {
  connection: CorelnConnectionInterface

  constructor(connection: CorelnConnectionInterface) {
    this.connection = connection
  }

  async get(): Promise<Offer[]> {
    try {
      const [offersResponse, invoiceRequestsResponse] = await Promise.all([
        this.connection.rpc({ method: 'listoffers' }),
        this.connection.rpc({ method: 'listinvoicerequests' })
      ])

      const { offers } = offersResponse as ListOffersResponse
      const { invoicerequests } = invoiceRequestsResponse as ListInvoiceRequestsResponse

      const formatted = [...offers, ...invoicerequests].map(async (offer) => {
        const { offer_id, bolt12, active, single_use, used, label } = offer as OfferSummary
        const { invreq_id } = offer as InvoiceRequestSummary
        const formattedOffer = await bolt12ToOffer(bolt12, offer_id || invreq_id)

        return {
          ...formattedOffer,
          active,
          single_use,
          used,
          bolt12,
          label
        }
      })

      return Promise.all(formatted)
    } catch (error) {
      const context = 'get (offers)'
      throw handleError(error as CoreLnError, context)
    }
  }

  async createPay(options: CreatePayOfferOptions): Promise<Offer> {
    try {
      const { amount, description, issuer, label, quantityMax, expiry, singleUse } = options

      const result = await this.connection.rpc({
        method: 'offer',
        params: {
          amount,
          description,
          issuer,
          label,
          quantity_max: quantityMax,
          absolute_expiry: expiry,
          single_use: singleUse
        }
      })

      const { offer_id, bolt12, used, single_use, active } = result as CreatePayOfferResponse

      return {
        id: offer_id,
        bolt12,
        type: 'pay',
        denomination: BitcoinDenomination.msats,
        amount,
        description,
        nodeId: this.connection.info.id,
        used,
        singleUse: single_use,
        active,
        label,
        expiry,
        issuer,
        quantityMax
      }
    } catch (error) {
      const context = 'createPay (offers)'
      throw handleError(error as CoreLnError, context)
    }
  }

  async disablePay(offerId: string): Promise<void> {
    try {
      await this.connection.rpc({ method: 'disableoffer', params: { offer_id: offerId } })
    } catch (error) {
      const context = 'disablePay (offers)'
      throw handleError(error as CoreLnError, context)
    }
  }

  async createWithdraw(options: CreateWithdrawOfferOptions): Promise<Offer> {
    try {
      const { amount, description, issuer, label, expiry, singleUse } = options

      const result = await this.connection.rpc({
        method: 'invoicerequest',
        params: {
          amount,
          description,
          issuer,
          label,
          absolute_expiry: expiry,
          single_use: singleUse
        }
      })

      const { invreq_id, bolt12, used, single_use, active } = result as CreateWithdrawOfferResponse

      return {
        id: invreq_id,
        bolt12,
        type: 'withdraw',
        denomination: BitcoinDenomination.msats,
        amount,
        description,
        nodeId: this.connection.info.id,
        used,
        singleUse: single_use,
        active,
        label,
        expiry,
        issuer
      }
    } catch (error) {
      const context = 'createWithdraw (offers)'
      throw handleError(error as CoreLnError, context)
    }
  }

  async disableWithdraw(invoiceRequestId: string): Promise<void> {
    try {
      await this.connection.rpc({
        method: 'disableinvoicerequest',
        params: { invreq_id: invoiceRequestId }
      })
    } catch (error) {
      const context = 'disableWithdraw (offers)'
      throw handleError(error as CoreLnError, context)
    }
  }

  async fetchInvoice(options: FetchInvoiceOptions): Promise<string> {
    try {
      const { amount, offer, quantity, timeout, payerNote } = options

      const result = await this.connection.rpc({
        method: 'fetchinvoice',
        params: {
          offer,
          amount_msat: amount,
          quantity,
          timeout,
          payer_note: payerNote
        }
      })

      const { invoice } = result as FetchInvoiceResponse

      return invoice
    } catch (error) {
      const context = 'fetchInvoice (offers)'
      throw handleError(error as CoreLnError, context)
    }
  }

  async sendInvoice(options: SendInvoiceOptions): Promise<Invoice> {
    try {
      const { offer, label, amount, timeout, quantity } = options
      const createdAt = nowSeconds()

      const orderedParams = amount
        ? [offer, label, amount, timeout, quantity]
        : [offer, label, timeout, quantity]

      const result = await this.connection.rpc({ method: 'sendinvoice', params: orderedParams })

      const {
        payment_hash,
        payment_preimage,
        status,
        bolt12,
        expires_at,
        paid_at,
        amount_received_msat,
        pay_index
      } = result as SendInvoiceResponse

      return {
        id: label,
        hash: payment_hash,
        preimage: payment_preimage,
        type: 'bolt12',
        direction: 'receive',
        value: formatMsat((amount_received_msat || amount) as string),
        completedAt: paid_at ? paid_at : nowSeconds(),
        expiresAt: expires_at,
        startedAt: createdAt,
        fee: null,
        status: invoiceStatusToPaymentStatus(status as InvoiceStatus),
        invoice: bolt12,
        payIndex: pay_index,
        nodeId: this.connection.info.id
      }
    } catch (error) {
      const context = 'sendInvoice (offers)'
      throw handleError(error as CoreLnError, context)
    }
  }
}

export default Offers