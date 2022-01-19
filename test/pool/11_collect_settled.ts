import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { poolTestFixture } from '../shared/fixtures';
import { bn } from '../shared/utils';

describe('pool collect settled positions', () => {
  let pool: MockPool;

  it('not yet settled');

  it('non limit-order position');

  it('empty position');

  it('exceeded position liquidity')

  // test subsequent swaps won't make it accrue more fees
  // test collect all -> normal position
  it('collect successfully');
});
