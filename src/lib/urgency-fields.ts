export const urgencyFields = [
  'cvssScore',
  'isCisaKev',
  'veeamConfirmedActiveExploitation',
] as const

export type UrgencyInput = {
  [K in (typeof urgencyFields)[number]]?: K extends 'cvssScore' ? number : boolean
}
