/**
 * transactionStore.js — Bank ki in-memory transaction ledger
 *
 * ReqPay process hone ke baad yahan save hota hai, taaki ReqChkTxn
 * (status check) aur ReqRefund (reversal) baad me isko lookup kar sake.
 * Sirf demo/learning ke liye — restart pe data udd jaata hai.
 */

const transactions = new Map();

export function saveTransaction(txn) {
  transactions.set(txn.transactionId, txn);
}

export function getTransaction(transactionId) {
  return transactions.get(transactionId);
}

export function markRefunded(transactionId, refundRef) {
  const txn = transactions.get(transactionId);
  if (!txn) return null;
  txn.status    = 'REFUNDED';
  txn.refundRef = refundRef;
  return txn;
}
