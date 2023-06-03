export type Transaction = {
  hash: string
  rawtx: string
  blockheight: number | null
  txindex: number | null
  locktime: number
  version: number
  rbfEnabled: boolean
  inputs: Array<{
    txid: string
    index: number
    sequence: number
  }>
  outputs: Array<{
    index: number
    amount_msat: string
  }>
  /** the node this onchain tx is associated with */
  nodeId?: string
}

export type SendTransactionOptions = {
  /** amount to send msats */
  amount: string
  /** the address to send to */
  address: string
  /** the fee rate in sats/vbyte */
  feeRate?: number
  /** select which utxo(s) to use for the transaction
   * format is `<txid>:<vout>`
   */
  utxos?: string[]
}