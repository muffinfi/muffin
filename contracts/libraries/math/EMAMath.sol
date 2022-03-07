// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

library EMAMath {
    uint256 private constant Q64 = 0x10000000000000000;
    uint256 private constant Q128 = 0x100000000000000000000000000000000;

    /**
     *  Definition:
     *  EMA[T] = a * P[T] + (1-a) * EMA[T-1]
     *  -   EMA[T]: EMA price at time T
     *  -   P[T]:   price at time T
     *  -   a:      smoothing factor, 0 < a ≤ 1
     *
     *  For 1-second sampling interval,
     *  -   Using common convention of EMA period:  a = 2/(N+1)
     *  -   Using half-life:                        a = 1 - 2^(-1/H)
     *  -   Combining both formula:             =>  a = 1 - (N+1)/(N-1)
     *
     *  For t-second interval,
     *  -   a = 1 - ((N-1)/(N+1))^t
     *
     *  We want to calculate the decay factor (i.e. 1-a) for a 40-min EMA.
     *  Let N = 2400 sec,
     *      u = (N-1)/(N+1) = 0.99916701374...
     *      t = seconds elapsed since last EMA update
     *  Find d = u^t
     */

    /// @dev Calculate the EMA decay factors for the given time elapsed
    /// @param t The seconds elapsed
    /// @return d40 The decay factor for 40-min EMA (UQ1.64)
    /// @return d20 The decay factor for 20-min EMA (UQ1.64)
    function calcDecayFactors(uint256 t) internal pure returns (uint256 d40, uint256 d20) {
        unchecked {
            if (t == 0) return (Q64, Q64);
            if (t > 0x7FFF) return (0, 0);

            uint256 r = Q128;
            if (t & 0x1 > 0)    r = (r * 0xffc968cf460d02069c4ee6846cc13312) >> 128;
            if (t & 0x2 > 0)    r = (r * 0xff92dd42adf2fb3347a0669781ab2e57) >> 128;
            if (t & 0x4 > 0)    r = (r * 0xff25e90bf5d4ab4a5c619d95eb393837) >> 128;
            if (t & 0x8 > 0)    r = (r * 0xfe4c8be3055982c3d3ae013e53c8b3e9) >> 128;
            if (t & 0x10 > 0)   r = (r * 0xfc9bfc79d9d91dc3ed2e27589c6d5b85) >> 128;
            if (t & 0x20 > 0)   r = (r * 0xf943781b99715e66e16dbe1cce12aef7) >> 128;
            if (t & 0x40 > 0)   r = (r * 0xf2b4516dc74abdcf8ec48d5b6e6d386f) >> 128;
            if (t & 0x80 > 0)   r = (r * 0xe61968f629103727f2b4a3aa92de4283) >> 128;
            if (t & 0x100 > 0)  r = (r * 0xced1ab1ffce61656ac7aa6096bfb959a) >> 128;
            if (t & 0x200 > 0)  r = (r * 0xa7161b2057a0fb7e928201aaadf2685a) >> 128;
            if (t & 0x400 > 0)  r = (r * 0x6d0dd94cdec2ee5c58312f3c61ff86b0) >> 128;
            if (t & 0x800 > 0)  r = (r * 0x2e74cbcb3ff407825627956641b8c466) >> 128;
            if (t & 0x1000 > 0) r = (r * 0x86e2e865d69a0a525faef3805152c7d) >> 128;
            if (t & 0x2000 > 0) r = (r * 0x47125469c370e842b1c3702f00951e) >> 128;
            if (t & 0x4000 > 0) r = (r * 0x13bb2c22a51db0a9a83ae6b594c4) >> 128;
            // stop here since t < 0x8000

            d40 = r >> 64;
            d20 = (r * r) >> 192; // approximation
        }
    }
}
