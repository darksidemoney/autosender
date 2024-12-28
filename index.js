const solanaWeb3 = require('@solana/web3.js');
const bs58 = require('bs58'); // Base58 encoding library (used by Solana)
const readline = require('readline');
global.punycode = require('punycode');

// Helper for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Ask a question and return a promise
const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

/**
 * Send 0.0001 SOL from user's wallet to recipient, with retry logic for expired transactions and rent balance checks.
 */
async function sendSolWithRetry(connection, userWallet, recipientAddress, lamports) {
  try {
    const transaction = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: userWallet.publicKey,
        toPubkey: new solanaWeb3.PublicKey(recipientAddress),
        lamports: lamports,
      })
    );

    // Fetch and assign a recent blockhash
    const { blockhash } = await connection.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userWallet.publicKey;

    // Send and confirm transaction
    const signature = await solanaWeb3.sendAndConfirmTransaction(connection, transaction, [userWallet]);
    console.log(`✅ Transaction successful! Signature: ${signature}`);
  } catch (error) {
    if (error.message.includes('block height exceeded')) {
      console.log('Transaction expired. Retrying with a new blockhash...');
      await sendSolWithRetry(connection, userWallet, recipientAddress, lamports); // Retry
    } else {
      console.error('❌ Error sending SOL:', error);
    }
  }
}

/**
 * Periodically send 0.0001 SOL at user-defined intervals, checking balance before sending.
 */
async function sendSolPeriodically(userWallet, recipientAddress, connection, intervalMinutes) {
  const INTERVAL_MS = intervalMinutes * 60 * 1000; // User-defined interval in milliseconds
  const AMOUNT_LAMPORTS = 100_000; // 0.0001 SOL in lamports
  const MIN_BALANCE_FOR_RENT_EXEMPTION = 0.00203928 * solanaWeb3.LAMPORTS_PER_SOL; // Rent-exempt balance

  console.log(`\n--- Monitoring Wallet and Sending 0.0001 SOL Every ${intervalMinutes} Minutes ---\n`);

  const sendSol = async () => {
    try {
      // Check wallet balance
      const balance = await connection.getBalance(userWallet.publicKey);
      console.log(`\nCurrent Balance: ${balance} lamports (${balance / solanaWeb3.LAMPORTS_PER_SOL} SOL)`);

      if (balance >= AMOUNT_LAMPORTS + MIN_BALANCE_FOR_RENT_EXEMPTION) {
        console.log(`Sending ${AMOUNT_LAMPORTS} lamports (0.0001 SOL) to ${recipientAddress}...`);
        await sendSolWithRetry(connection, userWallet, recipientAddress, AMOUNT_LAMPORTS);
      } else {
        console.log('❌ Balance too low for transaction and rent exemption. Skipping transaction.');
      }
    } catch (error) {
      console.error('❌ Error during balance check or transaction:', error);
    }
  };

  // Run the sendSol function periodically based on user-defined interval
  sendSol(); // Run immediately on startup
  setInterval(sendSol, INTERVAL_MS);
}

/**
 * Main function to set up the wallet and recipient address
 */
async function main() {
  console.log('\n--- Solana Automated Wallet ---\n');

  // Ask if the user wants to provide their own private key
  const useCustomPrivateKey = await askQuestion('Do you want to use your own private key? (yes/no): ');
  let userWallet;

  if (useCustomPrivateKey.toLowerCase() === 'yes') {
    // Ask for the user's private key
    const privateKeyBase58 = await askQuestion('Enter your wallet private key (Base58): ');

    try {
      // Decode private key and create Keypair
      const privateKeyUint8Array = bs58.decode(privateKeyBase58);
      userWallet = solanaWeb3.Keypair.fromSecretKey(privateKeyUint8Array);
    } catch (error) {
      console.error('\n❌ Invalid private key! Please make sure it is Base58-encoded.');
      rl.close();
      return;
    }
  } else {
    // Generate a new wallet
    userWallet = solanaWeb3.Keypair.generate();

    console.log('\n--- Wallet Created ---');
    console.log(`Public Key (Address): ${userWallet.publicKey.toBase58()}`);
    console.log('\nTo use this program, send SOL to the above wallet address.');
    console.log('You can fund it from an exchange or transfer from another wallet.');
    console.log('\nThe program will start once the wallet is funded.\n');
  }

  // Ask for the recipient address
  const recipientAddress = await askQuestion('Enter the recipient address (Base58): ');

  try {
    // Validate the recipient address
    new solanaWeb3.PublicKey(recipientAddress);
  } catch (error) {
    console.error('\n❌ Invalid recipient address! Please make sure it is Base58-encoded.');
    rl.close();
    return;
  }

  // Ask for the time interval
  const intervalMinutes = parseFloat(await askQuestion('Enter the time interval (in minutes): '));

  if (isNaN(intervalMinutes) || intervalMinutes <= 0) {
    console.error('\n❌ Invalid time interval! Please enter a positive number.');
    rl.close();
    return;
  }

  rl.close();

  // Connect to the Solana cluster (mainnet-beta for real transactions)
  const connection = new solanaWeb3.Connection(
    solanaWeb3.clusterApiUrl('mainnet-beta'), // or 'devnet' for testing
    'finalized' // Higher commitment level for stronger confirmations
  );

  console.log('\n--- Wallet and Recipient Details ---');
  console.log(`Your Public Key: ${userWallet.publicKey.toBase58()}`);
  console.log(`Recipient Address: ${recipientAddress}`);
  console.log(`Time Interval: ${intervalMinutes} minutes`);
  console.log('\nStarting automated transaction monitoring...\n');

  // Start monitoring and sending SOL periodically
  sendSolPeriodically(userWallet, recipientAddress, connection, intervalMinutes);
}

// Run the main function
main().catch((err) => {
  console.error('Error:', err);
  rl.close();
});
