/** Use the same model for the header, composer capabilities, effort and new requests. */
export function resolveChatModel<T extends { id: string; isDefault: boolean }>(
  models: readonly T[],
  modelId: string | null | undefined,
): T | undefined {
  return models.find((model) => model.id === modelId)
    ?? models.find((model) => model.isDefault)
    ?? models[0];
}
