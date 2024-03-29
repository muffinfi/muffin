import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { waffle } from 'hardhat';
import { IMockMuffinHub } from '../../typechain';
import { hubWithPoolFixture } from '../shared/fixtures';

describe('hub pool settings', () => {
  let hub: IMockMuffinHub;
  let user: SignerWithAddress;
  let other: SignerWithAddress;
  let poolId: string;

  beforeEach(async () => {
    ({ hub, user, other, poolId } = await waffle.loadFixture(hubWithPoolFixture));
    expect(await hub.governance()).eq(user.address);
  });

  it('cannot called by governance', async () => {
    await expect(hub.connect(other).setTierParameters(poolId, 0, 90000, 0)).to.be.revertedWith('');
    await expect(hub.connect(other).setPoolParameters(poolId, 123, 234)).to.be.revertedWith('');
    await expect(hub.connect(other).setGovernance(other.address)).to.be.revertedWith('');
    await expect(hub.connect(other).setDefaultParameters(123, 234)).to.be.revertedWith('');
    await expect(hub.connect(other).setDefaultAllowedSqrtGammas([99999])).to.be.revertedWith('');
    await expect(hub.connect(other).setPoolAllowedSqrtGammas(poolId, [99999])).to.be.revertedWith('');
    await expect(hub.connect(other).setPoolDefaultTickSpacing(poolId, 123)).to.be.revertedWith('');
  });

  it('setTierParameters', async () => {
    const sqrtPrice = (await hub.getTier(poolId, 0)).sqrtPrice;
    await expect(hub.setTierParameters(poolId, 0, 90000, 10))
      .to.emit(hub, 'UpdateTier')
      .withArgs(poolId, 0, 90000, sqrtPrice, 10);
    expect((await hub.getTier(poolId, 0)).sqrtGamma).eq(90000);
    expect((await hub.getLimitOrderTickSpacingMultipliers(poolId))[0]).eq(10);
  });

  it('setPoolParameters', async () => {
    await expect(hub.setPoolParameters(poolId, 123, 234)).to.emit(hub, 'UpdatePool').withArgs(poolId, 123, 234);
    expect((await hub.getPoolParameters(poolId)).tickSpacing).eq(123);
    expect((await hub.getPoolParameters(poolId)).protocolFee).eq(234);
  });

  it('setGovernance', async () => {
    await expect(hub.setGovernance(other.address)).to.emit(hub, 'GovernanceUpdated').withArgs(other.address);
    expect(await hub.governance()).eq(other.address);
  });

  it('setDefaultParameters', async () => {
    await hub.setDefaultParameters(123, 234);
    expect((await hub.getDefaultParameters()).tickSpacing).eq(123);
    expect((await hub.getDefaultParameters()).protocolFee).eq(234);
  });

  it('setDefaultAllowedSqrtGammas', async () => {
    await hub.setDefaultAllowedSqrtGammas([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await hub.getDefaultAllowedSqrtGammas()).deep.eq([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('setPoolAllowedSqrtGammas', async () => {
    await hub.setPoolAllowedSqrtGammas(poolId, [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await hub.getPoolAllowedSqrtGammas(poolId)).deep.eq([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('setPoolDefaultTickSpacing', async () => {
    await hub.setPoolDefaultTickSpacing(poolId, 147);
    expect(await hub.getPoolDefaultTickSpacing(poolId)).eq(147);
  });
});
