import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { waffle } from 'hardhat';
import { IMockMuffinHub, MockCaller, MockERC20 } from '../../typechain';
import { LimitOrderType } from '../shared/constants';
import { hubWithPoolFixture } from '../shared/fixtures';

const POS_REF_ID = 777;

describe('hub set limit order', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  const tickLower = -1;
  const tickUpper = 1;

  beforeEach(async () => {
    ({ hub, caller, token0, token1, user, poolId } = await waffle.loadFixture(hubWithPoolFixture));
    await hub.setTierParameters(poolId, 0, 99850, 2);
    await caller.mint({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: tickLower,
      tickUpper: tickUpper,
      liquidityD8: 100,
      recipient: user.address,
      positionRefId: POS_REF_ID,
      senderAccRefId: 0,
      data: [],
    });
  });

  it('set limit order successfully', async () => {
    const promise = hub.setLimitOrderType(
      token0.address,
      token1.address,
      0,
      tickLower,
      tickUpper,
      POS_REF_ID,
      LimitOrderType.ZERO_FOR_ONE,
    );
    await expect(promise)
      .to.emit(hub, 'SetLimitOrderType')
      .withArgs(poolId, user.address, POS_REF_ID, 0, tickLower, tickUpper, LimitOrderType.ZERO_FOR_ONE);
  });
});
