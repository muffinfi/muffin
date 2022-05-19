import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { MockCaller, IMockMuffinHub, MockERC20 } from '../../typechain';
import { hubFixture } from '../shared/fixtures';

describe('hub accounts', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let user: SignerWithAddress;

  beforeEach(async () => {
    ({ hub, caller, token0, user } = await waffle.loadFixture(hubFixture));
  });

  const getAccBalance = async (owner: string, accRefId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accRefId]));
    return await hub.accounts(token0.address, accHash);
  };

  context('deposit', () => {
    it('zero account id', async () => {
      const promise = caller.deposit(caller.address, 0, token0.address, 100, '');
      await expect(promise).to.be.revertedWith('');
    });

    it('zero token in', async () => {
      const promise = caller.deposit(caller.address, 1, token0.address, 100, 'NO_TOKEN_IN');
      await expect(promise).to.be.revertedWith('NotEnoughTokenInput()');
    });

    it('reentrancy attack', async () => {
      const promise = caller.deposit(caller.address, 1, token0.address, 100, 'REENTRANCY_ATTACK');
      await expect(promise).to.be.revertedWith('');
    });

    it('deposit successfully', async () => {
      expect(await getAccBalance(caller.address, 1)).eq(0);

      await expect(caller.deposit(user.address, 1, token0.address, 100, ''))
        .to.emit(hub, 'Deposit')
        .withArgs(user.address, 1, token0.address, 100, caller.address);

      expect(await getAccBalance(user.address, 1)).eq(100);
    });
  });

  context('withdraw', () => {
    beforeEach(async () => {
      await hub.addAccountBalance(user.address, 2, token0.address, 100);
    });

    it('not enough fund', async () => {
      await expect(hub.withdraw(caller.address, 2, token0.address, 101)).to.be.revertedWith('NotEnoughFundToWithdraw()');
    });

    it('withdraw successfully', async () => {
      const hubBalanceBefore = await token0.balanceOf(hub.address);
      const callerBalanceBefore = await token0.balanceOf(caller.address);
      expect(await getAccBalance(user.address, 2)).eq(100);

      await expect(hub.withdraw(caller.address, 2, token0.address, 100))
        .to.emit(hub, 'Withdraw')
        .withArgs(user.address, 2, token0.address, 100, caller.address);

      expect(await getAccBalance(user.address, 2)).eq(0);
      expect((await token0.balanceOf(hub.address)).sub(hubBalanceBefore)).eq(-100);
      expect((await token0.balanceOf(caller.address)).sub(callerBalanceBefore)).eq(100);
    });
  });
});
