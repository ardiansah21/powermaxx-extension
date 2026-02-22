export const sendRuntimeMessage = <TResponse>(
  payload: Record<string, unknown>
): Promise<TResponse> =>
  new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const runtimeError = chrome.runtime.lastError?.message
        if (runtimeError) {
          reject(new Error(runtimeError))
          return
        }
        resolve(response as TResponse)
      })
    } catch (error) {
      reject(error)
    }
  })
