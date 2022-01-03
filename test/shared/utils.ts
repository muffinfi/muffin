import { expect, use } from 'chai';
import chalk from 'chalk';
import { BigNumber, BigNumberish, Contract, ContractFactory, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import { jestSnapshotPlugin } from 'mocha-chai-jest-snapshot';
import util from 'util';
import { MIN_TICK, MIN_TICK_SPACING } from './constants';

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
//                            TEST HELPERS
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
