export interface VerificationEmail {
  to: string;
  firstName: string;
  verifyUrl: string;
}

export interface PasswordResetEmail {
  to: string;
  firstName: string;
  resetUrl: string;
}

/** Sent when someone tries to register with an email that already has an account. */
export interface DuplicateSignupEmail {
  to: string;
  firstName: string;
  loginUrl: string;
  resetUrl: string;
}

export interface EmailService {
  sendVerification(input: VerificationEmail): Promise<void>;
  sendPasswordReset(input: PasswordResetEmail): Promise<void>;
  sendDuplicateSignupNotice(input: DuplicateSignupEmail): Promise<void>;
}
