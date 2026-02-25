# Bridge Regression Checklist

## Fast Checks

1. Run static guard:
   - `npm run check:bridge-regression`
2. Ensure TypeScript and build pass:
   - `npx tsc --noEmit`
   - `npm run build`

## Browser E2E Quick Flow

1. Load extension from `build/chrome-mv3-dev`.
2. Open Powermaxx web page.
3. Send bridge request from browser console:

```js
window.postMessage(
  {
    source: "powermaxx",
    action: "update_order",
    mode: "single",
    batch_id: "regression-single-1",
    orders: [{ id: "ORDER-1", marketplace: "shopee", id_type: "order_sn" }]
  },
  "*"
)
```

4. Verify response/event envelope:
   - `source: "powermaxx_extension"`
   - `mode`, `batch_id`, `worker_id`
   - worker event names: `batch.started`, `batch.job.start`, `batch.job.finish`, `batch.finished`
5. Verify error taxonomy fields on failure paths:
   - `error_code`
   - `error_message`
   - `technical_error`
   - `action_hint`
