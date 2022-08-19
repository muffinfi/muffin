import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chalk from 'chalk';
import {
  BigNumber,
  BigNumberish,
  constants,
  Contract,
  ContractFactory,
  ContractReceipt,
  ContractTransaction,
  Wallet,
} from 'ethers';
import { serializeTransaction, splitSignature } from 'ethers/lib/utils';
import hre, { ethers } from 'hardhat';
import util from 'util';
import { ERC20Permit, MockERC20 } from '../typechain';

//////////////////////////////////////////////////////////////////////////
//                          PATCH BIGNUMBER
//////////////////////////////////////////////////////////////////////////

Object.defineProperties(BigNumber.prototype, {
  exponent: {
    get: function (): number {
      return this.toString().replace(/^\-/, '').length - 1;
    },
  },
  detail: {
    get: function (): string {
      return `BN: ${chalk.yellow(this.toString())} (exp: ${this.exponent})`;
    },
  },
  [util.inspect.custom]: {
    value: function (): string {
      return `BN: ${chalk.yellow(this.toString())} (exp: ${this.exponent})`;
    },
  },
});

//////////////////////////////////////////////////////////////////////////
//                           DEPLOY HELPERS
//////////////////////////////////////////////////////////////////////////

export const ensureNetwork = (name: string) => {
  if (hre.network.name !== name) {
    throw new Error('incorrect network');
  }
};

export const deploy = async (factoryName: string | ContractFactory, ...args: any[]) => {
  const factory = typeof factoryName === 'string' ? await ethers.getContractFactory(factoryName) : factoryName;
  const contract = await factory.deploy(...args);
  const tx = contract.deployTransaction;

  console.log('');
  console.log('date:      ', new Date());
  console.log('deploying: ', typeof factoryName === 'string' ? factoryName : '<ContractFactory>');
  console.log('tx hash:   ', tx.hash);

  await contract.deployed();
  console.log('address:   ', contract.address);

  const receipt = await tx.wait();
  console.log('gas used:  ', +receipt.gasUsed, ` ($${gasFeeUsd(+receipt.gasUsed)})`);
  console.log('');

  return contract;
};

export const getOrDeployContract = async <T extends Contract>(
  contractName: string,
  addressMap: Record<string, string | boolean>,
  deployArgs: any[] = [],
) => {
  const address = addressMap[hre.network.name];
  if (!address) throw new Error(`Unsupported network for ${contractName}`);

  return typeof address === 'string'
    ? (ethers.getContractAt(contractName, address) as Promise<T>)
    : (deploy(contractName, ...deployArgs) as Promise<T>);
};

export const logTx = async (
  txOrPromise: ContractTransaction | Promise<ContractTransaction>,
  note?: string,
  callback?: (rec: ContractReceipt, tx: ContractTransaction) => void,
) => {
  console.log('date:      ', new Date());
  if (note) console.log('note:      ', note);
  const tx = await txOrPromise;
  console.log('tx hash:   ', tx.hash);

  const receipt = await tx.wait();
  console.log('gas used:  ', +receipt.gasUsed, ` ($${gasFeeUsd(+receipt.gasUsed)})`);

  if (callback) callback(receipt, tx);
  console.log('');
};

//////////////////////////////////////////////////////////////////////////
//                               MATHS
//////////////////////////////////////////////////////////////////////////

const gasFeeUsd = (v: number, dp: number = 1) => Math.floor(v * 30 * 0.000000001 * 2000 * 10 ** dp) / 10 ** dp; // 30 gwei, 2000 eth price

export const wad = (v: number | string) => ethers.utils.parseEther(`${v}`.replace(/_/g, ''));

export const bn = (v: BigNumberish) => BigNumber.from(v);

export const Q = (v: number) => BigNumber.from(2).pow(v);

//////////////////////////////////////////////////////////////////////////
//                   USE IN DEV MODE FOR DEBUGGING
//////////////////////////////////////////////////////////////////////////

export const formatStruct = (xs: any) =>
  Object.entries(xs)
    .filter(([k, _]) => !/^\d+$/.test(k))
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

export const printStruct = (name: string | null, struct: any) => {
  if (name != null) console.log(name);

  const items = Object.entries(struct).filter(([k, _]) => !/^\d+$/.test(k));
  const keyMaxLen = Math.max(11, Math.max(...items.map(([k]) => k.length))) + 2;
  items.forEach(([k, v]) => {
    console.log(`  ${`${k}:`.padEnd(keyMaxLen)}`, v);
  });
};

export const deployQuiet = async (factoryName: string | ContractFactory, ...args: any[]) => {
  ensureNetwork('hardhat');

  const factory = typeof factoryName === 'string' ? await ethers.getContractFactory(factoryName) : factoryName;
  const contract = await factory.deploy(...args);
  await contract.deployed();
  const receipt = await contract.deployTransaction.wait();
  console.log(
    'deployed:  ',
    typeof factoryName === 'string' ? factoryName : '<ContractFactory>',
    +receipt.gasUsed,
    ` ($${gasFeeUsd(+receipt.gasUsed)})`,
  );
  return contract;
};

export const logTxGas = async (
  txOrPromise: ContractTransaction | Promise<ContractTransaction>,
  note: string,
  callback?: (rec: ContractReceipt, tx: ContractTransaction) => any,
) => {
  const tx = await txOrPromise;
  const receipt = await tx.wait();
  console.log('call:      ', note, ' ', +receipt.gasUsed, `($${gasFeeUsd(+receipt.gasUsed)})`, ...(await getOptimismGasFee(tx)));
  if (callback) await callback(receipt, tx);
};

const LOG_OPTIMISM_GAS_FEE = false;

/**
 * https://community.optimism.io/docs/developers/build/transaction-fees/
 * OP gas fee =   L1DataFee + L2ExecFee
 * L1DataFee  =   L1GasPrice * [(countZeroBytes * 4 + countNonzeroBytes * 16) + 2100] * 1.000
 * L2ExecFee  =   gasUsed * L2GasPrice (0.001 gwei)
 */
const getOptimismGasFee = async (tx: ContractTransaction) => {
  if (!LOG_OPTIMISM_GAS_FEE) {
    return '';
  }
  const data = serializeTransaction({
    data: tx.data,
    to: tx.to,
    type: tx.type,
    gasPrice: undefined,
    gasLimit: tx.gasLimit,
    nonce: 88888, // Nonce for L2
  });
  const txDataGas =
    data.split('').reduce((acc, char) => acc + (char === '0' ? 4 : 16), 0) +
    2100 + //   overhead
    68 * 16; // 68 bytes signature
  const l1DataFeeEth = txDataGas * (30 / 1e9); // L1: 30 gwei
  const l2ExecFeeEth = Number((await tx.wait()).gasUsed) * (0.001 / 1e9); // L2: 0.001 gwei

  const fmt = (x: number, dp: number = 5) => (x * 2000).toFixed(dp); // 2000 USD per ETH
  return ['\t', txDataGas, `[$${fmt(l1DataFeeEth)}, $${fmt(l2ExecFeeEth)}]`];
};

//////////////////////////////////////////////////////////////////////////
//                             ERC20 PERMIT
//////////////////////////////////////////////////////////////////////////

export const permit = async (wallet: Wallet | SignerWithAddress, spender: string, token: ERC20Permit | MockERC20) => {
  const TYPES = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  const domain = {
    name: await token.name(),
    version: '1',
    chainId: await wallet.getChainId(),
    verifyingContract: token.address,
  };
  const values = {
    owner: wallet.address,
    spender: spender,
    value: constants.MaxUint256,
    nonce: await token.nonces(wallet.address),
    deadline: constants.MaxUint256,
  };
  const signature = await wallet._signTypedData(domain, TYPES, values);
  return splitSignature(signature);
};
