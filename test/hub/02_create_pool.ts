import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { MockCaller, IMockMuffinHub, MockERC20 } from '../../typechain';
import { hubFixture } from '../shared/fixtures';
import { bn, deploy } from '../shared/utils';

const Q72 = bn(1).shl(72);

describe('hub create pool', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  beforeEach(async () => {
    ({ hub, caller, token0, token1, user, poolId } = await waffle.loadFixture(hubFixture));
    await hub.addAccountBalance(user.address, 1, token0.address, 25600);
    await hub.addAccountBalance(user.address, 1, token1.address, 25600);
  });

  const getAccBalance = async (token: string, owner: string, accRefId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accRefId]));
    return await hub.accounts(token, accHash);
  };

  context('create pool', () => {
    it('zero token address', async () => {
      await expect(hub.createPool(constants.AddressZero, token1.address, 99850, Q72, 1)).to.be.revertedWith(
        'InvalidTokenOrder()',
      );
    });

    it('invalid token order', async () => {
      await expect(hub.createPool(token1.address, token0.address, 99850, Q72, 1)).to.be.revertedWith('InvalidTokenOrder()');
    });

    it('invalid sqrtGamma', async () => {
      await expect(hub.createPool(token0.address, token1.address, 99850 + 1, Q72, 1)).to.be.revertedWith('NotAllowedSqrtGamma()');
    });

    it('invalid sqrtGamma (pool-specific)', async () => {
      await hub.setPoolAllowedSqrtGammas(poolId, [99850 + 1]);
      await expect(hub.createPool(token0.address, token1.address, 99850, Q72, 1)).to.be.revertedWith('NotAllowedSqrtGamma()');
    });

    it('not enough token0', async () => {
      await hub.withdraw(caller.address, 1, token0.address, 1);
      await expect(hub.createPool(token0.address, token1.address, 99850, Q72, 1)).to.be.revertedWith('');
    });

    it('not enough token1', async () => {
      await hub.withdraw(caller.address, 1, token1.address, 1);
      await expect(hub.createPool(token0.address, token1.address, 99850, Q72, 1)).to.be.revertedWith('');
    });

    it('create pool successfully', async () => {
      expect(await getAccBalance(token0.address, user.address, 1)).eq(25600);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(25600);

      const promise = hub.createPool(token0.address, token1.address, 99850, Q72, 1);
      await promise;

      // check events
      expect(promise).to.emit(hub, 'PoolCreated').withArgs(token0.address, token1.address, poolId);
      expect(promise).to.emit(hub, 'UpdateTier').withArgs(poolId, 0, 99850, 0);

      // check underlying tokens are stored
      const underlying = await hub.underlyings(poolId);
      expect(underlying.token0).eq(token0.address);
      expect(underlying.token1).eq(token1.address);

      // check pool object created
      expect((await hub.getPoolParameters(poolId)).tickSpacing).gt(0);

      // check account balance change
      expect(await getAccBalance(token0.address, user.address, 1)).eq(0);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(0);
    });

    it('pool already created', async () => {
      await hub.addAccountBalance(user.address, 1, token0.address, 100_000_000);
      await hub.addAccountBalance(user.address, 1, token1.address, 100_000_000);
      await hub.createPool(token0.address, token1.address, 99850, Q72, 1);
      expect(hub.createPool(token0.address, token1.address, 99850, Q72, 1)).to.be.revertedWith('');
    });
  });

  context('add tier', () => {
    beforeEach(async () => {
      await hub.createPool(token0.address, token1.address, 99850, Q72, 1);
      await hub.addAccountBalance(user.address, 1, token0.address, 25600);
      await hub.addAccountBalance(user.address, 1, token1.address, 25600);
      expect(await getAccBalance(token0.address, user.address, 1)).eq(25600);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(25600);
    });

    it('zero token address', async () => {
      await expect(hub.addTier(constants.AddressZero, token1.address, 99850, 1)).to.be.revertedWith('');
    });

    it('invalid token order', async () => {
      await expect(hub.addTier(token1.address, token0.address, 99850, 1)).to.be.revertedWith('');
    });

    it('not enough token0', async () => {
      await hub.withdraw(caller.address, 1, token0.address, 1);
      await expect(hub.addTier(token0.address, token1.address, 99850, 1)).to.be.revertedWith('');
    });

    it('not enough token1', async () => {
      await hub.withdraw(caller.address, 1, token1.address, 1);
      await expect(hub.addTier(token0.address, token1.address, 99850, 1)).to.be.revertedWith('');
    });

    it('pool not created', async () => {
      const tokenC = (await deploy('MockERC20', 'CCC Token', 'CCC')) as MockERC20;
      const pair = token0.address.toLowerCase() < tokenC.address.toLowerCase() ? [token0, tokenC] : [tokenC, token0];
      await hub.addAccountBalance(user.address, 1, tokenC.address, 25600);
      await expect(hub.addTier(pair[0].address, pair[1].address, 99850, 1)).to.be.revertedWith('');
    });

    it('add tier successfully', async () => {
      const tierCount = await hub.getTiersCount(poolId);
      const promise = hub.addTier(token0.address, token1.address, 99850, 1);
      await promise;

      // check events
      expect(promise)
        .to.emit(hub, 'UpdateTier')
        .withArgs(poolId, +tierCount, 99850, 0);

      // check tier count
      expect(await hub.getTiersCount(poolId)).eq(tierCount.add(1));

      // check account balance change
      expect(await getAccBalance(token0.address, user.address, 1)).eq(0);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(0);
    });

    it('exceeded max tier count', async () => {
      await hub.addAccountBalance(user.address, 1, token0.address, 1e15);
      await hub.addAccountBalance(user.address, 1, token1.address, 1e15);

      for (let i = 0; i < 5; i++) await hub.addTier(token0.address, token1.address, 99850, 1);
      expect(await hub.getTiersCount(poolId)).eq(6);
      await expect(hub.addTier(token0.address, token1.address, 99850, 1)).to.be.revertedWith('');
    });
  });
});
