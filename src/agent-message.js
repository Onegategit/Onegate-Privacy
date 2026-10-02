// The agent's sign-in message, built the same way in the browser and on the server. It opens the agent for one wallet;
// it is not a transaction and is not the privacy protocol's own sign-in message.
export const AGENT_SIGN_IN = 'Onegate agent sign in';
export const AGENT_SESSION_HOURS = 6;
export const AGENT_MAX_INPUT = 1200;

export function agentSignInMessage(account, issued, nonce) {
  return `${AGENT_SIGN_IN}\nWallet: ${account}\nIssued: ${issued}\nNonce: ${nonce}\n\nThis signature opens the Onegate agent for this wallet. It is not a transaction and cannot move funds.`;
}

export const SUGGESTIONS = [
  'How is $OGATE trading right now?',
  'Quote 0.01 ETH of $OGATE',
  'What does a 0.1 ETH private withdrawal cost?',
  'Check my plan: deposit 0.137 ETH, withdraw it in an hour to my own wallet',
];
