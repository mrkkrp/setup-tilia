-- | A module that exists to be formatted.
module Kiln.Schedule
  ( rampRate,
    soakTime,
  )
where

-- | How fast the kiln may climb, in degrees an hour.
rampRate :: Int -> Int -> Int
rampRate held target = (target - held) * 60 `div` 45

-- | How long to hold once the target is reached.
soakTime :: Int -> Int
soakTime target
  | target > 1200 = 30
  | otherwise = 15
