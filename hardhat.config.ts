import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'dotenv/config';
import 'hardhat-contract-sizer';
import 'hardhat-storage-layout';
import { HardhatUserConfig, task } from 'hardhat/config';

task('layout', 'Print contract storage layout', async (_args, hre) => {
  await hre.run('compile');
  await hre.storageLayout.export();
});

task('compile-size-contracts', 'Compile and measure contract size', async (_args, hre) => {
  await hre.run('compile');
  await hre.run('size-contracts');
});

task('list-accounts', 'List account addresses', async (_args, hre) => {
  const signers = await hre.ethers.getSigners();
  signers.forEach((signer) => console.log(signer.address));
});

const basicCompiler = {
  version: '0.8.10',
  settings: {
    optimizer: { enabled: true, runs: 99999 },
    metadata: { bytecodeHash: 'none' },
  },
};

const managerCompiler = {
  version: '0.8.10',
  settings: {
    optimizer: { enabled: true, runs: 4500 },
    metadata: { bytecodeHash: 'none' },
  },
};

const testCompiler = {
  version: '0.8.10',
  settings: {
    optimizer: { enabled: true, runs: 0 },
  },
};

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      accounts: { accountsBalance: '1000000000000000000000000000000000000000000000' }, // 1e45
      initialBaseFeePerGas: 0,
      gasPrice: 0,
    },
    rinkeby: {
      url: process.env.RINKEBY_RPC,
      accounts: process.env.RINKEBY_ACCOUNT ? [process.env.RINKEBY_ACCOUNT] : undefined,
    },
    arbitrumTestnet: {
      url: 'https://rinkeby.arbitrum.io/rpc',
      accounts: process.env.ARBITRUM_TESTNET_ACCOUNT
        ? [process.env.ARBITRUM_TESTNET_ACCOUNT]
        : undefined,
    },
  },
  solidity: {
    compilers: [basicCompiler],
    overrides: {
      'contracts/periphery/Manager.sol': managerCompiler,
      'contracts/tests/MockPool.sol': testCompiler,
      'contracts/tests/MockMuffinHub.sol': testCompiler,
    },
  },
  etherscan: {
    apiKey: {
      rinkeby: process.env.ETHERSCAN_API_KEY_RINKEBY ?? '',
    },
  },
};

export default config;
