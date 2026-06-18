export interface Greeting {
  message: string;
  recipient: string;
}

/**
 * Build a friendly greeting for the given recipient.
 */
export function greet(recipient: string): Greeting {
  return {
    message: `Hello, ${recipient}!`,
    recipient,
  };
}
