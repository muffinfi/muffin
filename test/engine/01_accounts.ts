import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { Engine, MockCaller, MockERC20 } from '../../typechain';
import { engineFixture } from '../shared/fixtures';

describe('engine accounts', () => {
  let engine: Engine;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;

  beforeEach(async () => {
    ({ engine, caller, token0, token1, user } = await waffle.loadFixture(engineFixture));
  });

  const getAccId = () => {
    return keccak256(defaultAbiCoder.encode(['address', 'uint256'], [caller.address, 1]));
  };

  context('deposit', () => {
    it('not token in', async () => {
      const promise = caller.deposit(caller.address, 1, token0.address, 100, 'NO_TOKEN_IN');
      await expect(promise).to.be.revertedWith('NotEnoughToken()');
    });

    it('reentrancy attack', async () => {
      // FIXME: !!!
      await caller.deposit(caller.address, 1, token0.address, 100, 'REENTRANCY_ATTACK');
      expect(await engine.accounts(token0.address, getAccId())).eq(200);
    });

    it('deposit successfully', async () => {
      await caller.deposit(caller.address, 1, token0.address, 100, '');
      expect(await engine.accounts(token0.address, getAccId())).eq(100);
    });
  });
});
