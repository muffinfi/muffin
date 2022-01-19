import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { Manager, IMockEngine, MockERC20, WETH9 } from '../../typechain';
import { managerFixture } from '../shared/fixtures';
import { bn, expectBalanceChanges } from '../shared/utils';

describe('manager accounts', () => {
  let engine: IMockEngine;
  let manager: Manager;
  let token0: MockERC20;
  let weth: WETH9;
  let user: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async () => {
    ({ engine, manager, token0, weth, user, other } = await waffle.loadFixture(managerFixture));
  });

  const getAccBalance = async (token: string, userAddress: string) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [manager.address, bn(userAddress)]));
    return await engine.accounts(token, accHash);
  };

  context('deposit', () => {
    it('token', async () => {
      await manager.deposit(user.address, token0.address, 100);
      expect(await getAccBalance(token0.address, user.address)).eq(100);
    });

    it('weth', async () => {
      await manager.deposit(user.address, weth.address, 100);
      expect(await getAccBalance(weth.address, user.address)).eq(100);
    });

    it('eth', async () => {
      await manager.deposit(user.address, weth.address, 100, { value: 100 });
      expect(await getAccBalance(weth.address, user.address)).eq(100);
    });

    it('not enough token', async () => {
      await expect(manager.connect(other).deposit(user.address, token0.address, 100)).to.be.reverted;
    });

    it('not enough eth', async () => {
      await expect(manager.connect(other).deposit(user.address, weth.address, 100, { value: 99 })).to.be.reverted;
    });
  });

  context('withdraw', () => {
    beforeEach(async () => {
      await manager.deposit(user.address, token0.address, 100);
      await manager.deposit(user.address, weth.address, 100);
    });

    it('token', async () => {
      await expectBalanceChanges(
        [
          { account: engine, token: token0, delta: -100 },
          { account: user, token: token0, delta: 100 },
        ],
        async () => {
          await manager.withdraw(user.address, token0.address, 100);
          expect(await getAccBalance(token0.address, user.address)).eq(0);
        },
      );
    });

    it('eth (multicall: unwrapWETH)', async () => {
      await expectBalanceChanges(
        [
          { account: engine, token: weth, delta: -100 },
          { account: user, token: 'ETH', delta: 100 },
          { account: manager, token: weth, delta: 0 },
          { account: manager, token: 'ETH', delta: 0 },
        ],
        async () => {
          const data = [
            manager.interface.encodeFunctionData('withdraw', [manager.address, weth.address, 100]),
            manager.interface.encodeFunctionData('unwrapWETH', [100, user.address]),
          ];
          await manager.multicall(data);
        },
      );
    });
  });

  it('depositCallback called by non-engine', async () => {
    await expect(manager.depositCallback(token0.address, 1, [])).to.be.revertedWith('');
  });
});
