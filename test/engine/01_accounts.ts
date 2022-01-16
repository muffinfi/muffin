import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { MockCaller, MockEngine, MockERC20 } from '../../typechain';
import { engineFixture } from '../shared/fixtures';

describe('engine accounts', () => {
  let engine: MockEngine;
  let caller: MockCaller;
  let token0: MockERC20;
  let user: SignerWithAddress;

  beforeEach(async () => {
    ({ engine, caller, token0, user } = await waffle.loadFixture(engineFixture));
  });

  const getAccBalance = async (owner: string, accRefId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accRefId]));
    return await engine.accounts(token0.address, accHash);
  };

  context('deposit', () => {
    it('zero account id', async () => {
      const promise = caller.deposit(caller.address, 0, token0.address, 100, '');
      await expect(promise).to.be.revertedWith('');
    });

    it('zero token in', async () => {
      const promise = caller.deposit(caller.address, 1, token0.address, 100, 'NO_TOKEN_IN');
      await expect(promise).to.be.revertedWith('NotEnoughToken()');
    });

    it('reentrancy attack', async () => {
      const promise = caller.deposit(caller.address, 1, token0.address, 100, 'REENTRANCY_ATTACK');
      await expect(promise).to.be.revertedWith('');
    });

    it('deposit successfully', async () => {
      expect(await getAccBalance(caller.address, 1)).eq(0);
      await expect(caller.deposit(caller.address, 1, token0.address, 100, ''))
        .to.emit(engine, 'Deposit')
        .withArgs(caller.address, 1, token0.address, 100);
      expect(await getAccBalance(caller.address, 1)).eq(100);
    });
  });

  context('withdraw', () => {
    beforeEach(async () => {
      await engine.addAccountBalance(user.address, 2, token0.address, 100);
    });

    it('withdraw successfully', async () => {
      const engineBalanceBefore = await token0.balanceOf(engine.address);
      const callerBalanceBefore = await token0.balanceOf(caller.address);
      expect(await getAccBalance(user.address, 2)).eq(100);

      await expect(engine.withdraw(caller.address, 2, token0.address, 100))
        .to.emit(engine, 'Withdraw')
        .withArgs(caller.address, 2, token0.address, 100);

      expect(await getAccBalance(user.address, 2)).eq(0);
      expect((await token0.balanceOf(engine.address)).sub(engineBalanceBefore)).eq(-100);
      expect((await token0.balanceOf(caller.address)).sub(callerBalanceBefore)).eq(100);
    });
  });
});
