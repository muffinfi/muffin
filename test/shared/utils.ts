import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect, use } from 'chai';
import chalk from 'chalk';
import { BigNumber, BigNumberish, Contract, ContractFactory, ContractTransaction } from 'ethers';
import { solidityPack } from 'ethers/lib/utils';
import { ethers } from 'hardhat';
import { jestSnapshotPlugin } from 'mocha-chai-jest-snapshot';
import util from 'util';
import { MockERC20, WETH9 } from '../../typechain';
import { MAX_TIER_CHOICES } from './constants';

use(jestSnapshotPlugin());

export type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;

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
//                               MATHS
//////////////////////////////////////////////////////////////////////////

export const wad = (v: number | string) => ethers.utils.parseEther(`${v}`.replace(/_/g, ''));

export const bn = (v: BigNumberish) => BigNumber.from(typeof v === 'string' ? v.replace(/_/g, '') : v);

export const Q = (v: number) => BigNumber.from(2).pow(v);

// Babylon sqrt
export const sqrt = (y: BigNumber) => {
  let z = y;
  let x: BigNumber;
  if (y.gt(3)) {
    z = y;
    x = y.div(2).add(1);
    while (x.lt(z)) {
      z = x;
      x = y.div(x).add(x).div(2);
    }
  } else if (!y.eq(0)) {
    z = BigNumber.from('1');
  }
  return z;
};

export const sliceBits = (bitmap: BigNumber, startPos: number, len: number) => {
  // (bitmap >> startPos) % (1 << len)
  return bitmap.shr(startPos).mod(BigNumber.from(1).shl(len));
};

//////////////////////////////////////////////////////////////////////////
//                           DEPLOY HELPERS
//////////////////////////////////////////////////////////////////////////

export const deploy = async (factoryOrName: ContractFactory | string, ...args: any[]) => {
  const factory = typeof factoryOrName === 'string' ? await ethers.getContractFactory(factoryOrName) : factoryOrName;
  const contract = await factory.deploy(...args);
  await contract.deployed();
  return contract;
};

//////////////////////////////////////////////////////////////////////////
//                           COMMON HELPERS
//////////////////////////////////////////////////////////////////////////

export const getLatestBlockTimestamp = async () => {
  return (await ethers.provider.getBlock('latest')).timestamp;
};

export const setNextBlockTimestamp = async (ts: number) => {
  await ethers.provider.send('evm_setNextBlockTimestamp', [ts]);
};

export const gasUsed = async (tx: ContractTransaction) => (await tx.wait()).gasUsed.toNumber();

export const snapshotGasUsed = async (promise: Promise<ContractTransaction>) => {
  expect(await gasUsed(await promise)).toMatchSnapshot();
};

export const getEvent = async (tx: ContractTransaction, contract: Contract, eventName: string) => {
  for (const evt of (await tx.wait()).events || []) {
    if (evt.address == contract.address) {
      const parsed = contract.interface.parseLog({ topics: evt.topics, data: evt.data });
      if (parsed.name === eventName) {
        return parsed.args;
      }
    }
  }
  throw new Error(`Cannot find ${eventName} event`);
};

export const getEvents = async (tx: ContractTransaction, contract: Contract, eventName?: string) => {
  const parsedEvents = [];
  for (const evt of (await tx.wait()).events || []) {
    if (evt.address == contract.address) {
      const parsed = contract.interface.parseLog({ topics: evt.topics, data: evt.data });
      if (eventName == null || parsed.name === eventName) {
        parsedEvents.push(parsed.args);
      }
    }
  }
  return parsedEvents;
};

export const toPath = (tokens: (MockERC20 | WETH9)[]) => {
  const types = [];
  const values = [];
  for (const token of tokens) {
    types.push('address');
    types.push('uint16');
    values.push(token.address);
    values.push(MAX_TIER_CHOICES);
  }
  types.pop();
  values.pop();
  return solidityPack(types, values);
};

//////////////////////////////////////////////////////////////////////////
//                           COMMON CHECK
//////////////////////////////////////////////////////////////////////////

type BalanceChange = {
  account: Contract | SignerWithAddress | string;
  token: MockERC20 | WETH9 | 'ETH';
  delta: BigNumberish;
};

export const expectBalanceChanges = async (changes: BalanceChange[], fn: () => any) => {
  const getBalance = (token: BalanceChange['token'], account: BalanceChange['account']) => {
    const addr = typeof account === 'string' ? account : account.address;
    return token === 'ETH' ? ethers.provider.getBalance(addr) : token.balanceOf(addr);
  };

  const balancesBefore = [];
  for (const { token, account } of changes) balancesBefore.push(await getBalance(token, account));

  const retval = await fn();

  for (const [i, { token, account, delta }] of changes.entries()) {
    const balance = await getBalance(token, account);
    const errorMsg = `token #${i} balance should change ${delta}`;
    expect(balance.sub(balancesBefore[i]), errorMsg).eq(delta);
  }

  return retval;
};
