export { hashPassword, verifyPassword } from './password.ts';
export { newToken, hashToken, tokensMatch } from './tokens.ts';
export { signUp, signIn, UnderageError, ConsentRequiredError, resolveDeviceConfirmation, SESSION_TTL_DAYS, CONFIRMATION_TTL_MINUTES, type SignInResult, type DeviceInfo } from './signin.ts';
export type { AuthPorts, RecoveryPorts, VerificationPorts, AuthUser, AuthDevice, AttemptOutcome } from './ports.ts';
export {
  requestPasswordReset, completePasswordReset, RESET_TTL_MINUTES, MIN_PASSWORD_LENGTH,
  type ResetRequest, type ResetOutcome,
} from './recovery.ts';
export {
  sendEmailVerification, confirmEmail, VERIFICATION_TTL_HOURS,
  type VerificationRequest, type VerificationOutcome,
} from './verify.ts';
