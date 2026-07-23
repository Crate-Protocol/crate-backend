// The two contract events crate-contracts actually emits (see
// crate_marketplace::upload_sample / purchase_license):
//   env.events().publish((symbol_short!("uploaded"), sample_id), uploader)
//   env.events().publish((symbol_short!("licensed"), sample_id), (buyer, price))

export interface UploadedEvent {
  contractId: string;
  ledger: number;
  txHash: string;
  eventIndex: number;
  ledgerClosedAt: string;
  eventType: "uploaded";
  sampleId: bigint;
  uploader: string;
}

export interface LicensedEvent {
  contractId: string;
  ledger: number;
  txHash: string;
  eventIndex: number;
  ledgerClosedAt: string;
  eventType: "licensed";
  sampleId: bigint;
  buyer: string;
  price: bigint;
}

export type DecodedEvent = UploadedEvent | LicensedEvent;
