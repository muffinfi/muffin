import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'hardhat-contract-sizer';
import 'hardhat-storage-layout';
import { HardhatUserConfig, task } from 'hardhat/config';
import env from './env';

task('layout', 'Print contract storage layout', async (_args, hre) => {
  await hre.run('compile');
  await hre.storageLayout.export();
});

task('compile-size-contracts', 'Compile and measure contract size', async (_args, hre) => {
  await hre.run('compile');
  await hre.run('size-contracts');
});

const basicCompiler = {
  version: '0.8.10',
  settings: {
    optimizer: { enabled: true, runs: 9999 },
    metadata: { bytecodeHash: 'none' },
  },
};

const engineCompiler = {
  version: '0.8.10',
  settings: {
    optimizer: { enabled: true, runs: 5000 },
    metadata: { bytecodeHash: 'none' },
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
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    rinkeby: {
      url: env.rinkeby.url,
      accounts: { mnemonic: env.rinkeby.mnemonic },
    },
    mainnet: {
      url: env.mainnet.url,
      accounts: { mnemonic: env.mainnet.mnemonic },
    },
  },
  solidity: {
    compilers: [basicCompiler],
    overrides: {
      'contracts/Engine.sol': engineCompiler,
    },
  },
};

export default config;
