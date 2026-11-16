/** Exact original published source photos; not current physical-pack verification.
 * Open Food Facts photo contributors, CC BY-SA 3.0; packaging/trademark rights remain separate.
 * No photo is used to add nutrition or to complete an allergen statement.
 */
const PHOTO_SETS = {
  "P000000913": {
    "id": "P000000913",
    "barcode": "4891028166269",
    "productUrl": "https://world.openfoodfacts.org/product/4891028166269",
    "sourceLimit": "標籤照片上載於2026-06-03；有香港地址、淨容量、條碼及完整成分/Contains。沒有檢查當前實物。",
    "images": [
      {
        "role": "front",
        "author": "macrofactor",
        "uploadedAt": "2026-06-03T01:36:58.000Z",
        "license": "CC-BY-SA-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        "sourceUrl": "https://images.openfoodfacts.org/images/products/489/102/816/6269/4.jpg",
        "modifications": "None; original JPEG bytes",
        "sha256": "38cea938e663d70a0c5ca7fdf43041464be619e7291486f2bb4db88588d380fb",
        "path": "assets/product-photos/4891028166269-front-4.jpg"
      },
      {
        "role": "nutrition",
        "author": "macrofactor",
        "uploadedAt": "2026-06-03T01:37:02.000Z",
        "license": "CC-BY-SA-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        "sourceUrl": "https://images.openfoodfacts.org/images/products/489/102/816/6269/5.jpg",
        "modifications": "None; original JPEG bytes",
        "sha256": "cc80570ca7777b1e01fc687f6d9860772c85145bc6a46e3193028ac0d371a7c7",
        "path": "assets/product-photos/4891028166269-nutrition-5.jpg"
      }
    ]
  },
  "P000000902": {
    "id": "P000000902",
    "barcode": "4891028701484",
    "productUrl": "https://world.openfoodfacts.org/product/4891028701484",
    "sourceLimit": "營養照片上載2026-03-07；成分照片只有2022-04-02，不能當作現行完整過敏聲明。沒有檢查當前實物。",
    "images": [
      {
        "role": "front",
        "author": "macrofactor",
        "uploadedAt": "2026-03-07T15:00:36.000Z",
        "license": "CC-BY-SA-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        "sourceUrl": "https://images.openfoodfacts.org/images/products/489/102/870/1484/5.jpg",
        "modifications": "None; original JPEG bytes",
        "sha256": "87b9f799088ee8c18c913613ddf59812475c04545f637e786a2a3f75d842fe2e",
        "path": "assets/product-photos/4891028701484-front-5.jpg"
      },
      {
        "role": "nutrition",
        "author": "macrofactor",
        "uploadedAt": "2026-03-07T15:00:42.000Z",
        "license": "CC-BY-SA-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        "sourceUrl": "https://images.openfoodfacts.org/images/products/489/102/870/1484/6.jpg",
        "modifications": "None; original JPEG bytes",
        "sha256": "39fdf9599b89baf4b1903703d6a5526c9659cc90f2fecc9bb71f7beeddcd139a",
        "path": "assets/product-photos/4891028701484-nutrition-6.jpg"
      }
    ]
  }
};

export function getProductPhotoSet(product) {
  const set=PHOTO_SETS[product?.id];
  if(!set || (product.barcode && String(product.barcode)!==set.barcode))return null;
  return set;
}
