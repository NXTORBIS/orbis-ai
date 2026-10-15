// The tools were written against Base44's SDK. Orbis answers the same calls on this computer, in its own main
// process, so nothing leaves the machine except the public lookup a tool exists to make.
const invoke = async (name, payload) => ({ data: await window.api.jarvisInvoke(name, payload) })

export const base44 = {
  functions: { invoke },
  auth: { me: async () => ({ local: true }), isAuthenticated: async () => true }
}
