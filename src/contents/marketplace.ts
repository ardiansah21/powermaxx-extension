import type { PlasmoCSConfig } from "plasmo"

import type { ContentFetchRequest } from "~src/core/messages/contracts"
import { runMarketplaceFetchInPage } from "~src/features/fetch-send/content/page-runner"

export const config: PlasmoCSConfig = {
  matches: [
    "https://seller.shopee.co.id/*",
    "https://*.shopee.co.id/*",
    "https://seller-id.tokopedia.com/*"
  ],
  run_at: "document_start"
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "POWERMAXX_CONTENT_FETCH_SEND") {
    return
  }

  const payload = message as ContentFetchRequest

  runMarketplaceFetchInPage(payload.request)
    .then((result) => {
      sendResponse(result)
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: String((error as Error)?.message || error),
        orderRawJson: null,
        incomeRawJson: null,
        incomeDetailRawJson: null
      })
    })

  return true
})
