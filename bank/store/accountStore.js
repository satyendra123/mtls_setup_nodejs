/**
 * accountStore.js — Bank ka mock FASTag/vehicle account directory
 *
 * ReqListAccount isse vehicle → FASTag account details lookup karta hai.
 * Sirf demo/learning ke liye — hardcoded seed data.
 */

const accounts = new Map([
  ['MH12AB1234', { fastagId: 'FASTAG-MH12AB1234', vehicleClass: '4', status: 'ACTIVE',      balance: '1250.00' }],
  ['DL01CD5678', { fastagId: 'FASTAG-DL01CD5678', vehicleClass: '4', status: 'ACTIVE',      balance: '430.00'  }],
  ['KA05XY9999', { fastagId: 'FASTAG-KA05XY9999', vehicleClass: '6', status: 'BLACKLISTED', balance: '0.00'    }],
]);

export function lookupAccount(vehicleId) {
  return accounts.get(vehicleId);
}
