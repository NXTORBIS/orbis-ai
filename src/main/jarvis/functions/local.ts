// Stands in for Base44's request client: there is no account to check here, only this computer.
export const createClientFromRequest = (_req: unknown) => ({ auth: { me: async () => ({ local: true }) } })
