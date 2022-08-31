import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { utils } from 'ethers';
import { waffle } from 'hardhat';
import { IMockMuffinHub, MockCaller, MockERC20 } from '../../typechain';
import { LimitOrderType } from '../shared/constants';
import { hubWithPoolFixture } from '../shared/fixtures';
import { getEvent } from '../shared/utils';

const POS_REF_ID = 777;

describe('hub emit settle event', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  const tierId = 0;
  const tickLower = -1;
  const tickUpper = 1;
  const liquidityD8 = 10000;

  beforeEach(async () => {
    ({ hub, caller, token0, token1, user, poolId } = await waffle.loadFixture(hubWithPoolFixture));
    await hub.setTierParameters(poolId, 0, 99850, 2);
    await caller.mint({
      token0: token0.address,
      token1: token1.address,
      tierId,
      tickLower,
      tickUpper,
      liquidityD8,
      recipient: user.address,
      positionRefId: POS_REF_ID,
      senderAccRefId: 0,
      data: [],
    });
  });

  it('one for zero', async () => {
    await hub.setLimitOrderType(token0.address, token1.address, 0, tickLower, tickUpper, POS_REF_ID, LimitOrderType.ONE_FOR_ZERO);

    const tx = await caller.swap(token0.address, token1.address, 0x3f, 300, caller.address, 0, 0, utils.id(''));
    const event = await getEvent(tx, hub, 'Settle');
    expect(event.poolId).eq(poolId);
    expect(event.tierId).eq(tierId);
    expect(event.tickEnd).eq(tickLower);
    expect(event.tickStart).eq(tickUpper);
    expect(event.liquidityD8).eq(liquidityD8);
  });

  it('zero for one', async () => {
    await hub.setLimitOrderType(token0.address, token1.address, 0, tickLower, tickUpper, POS_REF_ID, LimitOrderType.ZERO_FOR_ONE);

    const tx = await caller.swap(token1.address, token0.address, 0x3f, 300, caller.address, 0, 0, utils.id(''));
    const event = await getEvent(tx, hub, 'Settle');
    expect(event.poolId).eq(poolId);
    expect(event.tierId).eq(tierId);
    expect(event.tickEnd).eq(tickUpper);
    expect(event.tickStart).eq(tickLower);
    expect(event.liquidityD8).eq(liquidityD8);
  });
});
