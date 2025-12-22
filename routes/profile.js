const express = require('express');
const { BabyProfile } = require('../database');
const { validateMeasurementValue } = require('../lib/validation');
const apiError = require('../lib/apiError');

const router = express.Router();

router.get('/baby-profile', async (req, res) => {
  try {
    const profile = await BabyProfile.getProfile();
    const latestMeasurement = await BabyProfile.getLatestMeasurement();

    let ageWeeks = null;
    let ageDays = null;
    if (profile && profile.date_of_birth) {
      const birthDate = new Date(profile.date_of_birth);
      const today = new Date();
      const diffTime = Math.abs(today - birthDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      ageWeeks = Math.floor(diffDays / 7);
      ageDays = diffDays % 7;
    }

    res.json({
      success: true,
      profile: profile || null,
      latestMeasurement: latestMeasurement || null,
      age: profile ? {
        weeks: ageWeeks,
        days: ageDays,
        totalDays: ageWeeks * 7 + ageDays
      } : null
    });
  } catch (error) {
    console.error('Error getting baby profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get baby profile'
    });
  }
});

router.post('/baby-profile', async (req, res) => {
  try {
    const { name, dateOfBirth } = req.body;

    if (!name || !dateOfBirth) {
      return res.status(400).json({
        success: false,
        error: 'Name and date of birth are required'
      });
    }

    const dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date of birth format'
      });
    }

    if (dob > new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Date of birth cannot be in the future'
      });
    }

    const profile = await BabyProfile.saveProfile(name, dateOfBirth);
    res.json({
      success: true,
      profile
    });
  } catch (error) {
    console.error('Error saving baby profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save baby profile'
    });
  }
});

router.post('/baby-measurements', async (req, res) => {
  try {
    const { measurementDate, weightKg, heightCm, headCircumferenceCm, notes } = req.body;

    if (!measurementDate) {
      return res.status(400).json({
        success: false,
        error: 'Measurement date is required'
      });
    }

    const measureDate = new Date(measurementDate);
    if (Number.isNaN(measureDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid measurement date format'
      });
    }

    if (measureDate > new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Measurement date cannot be in the future'
      });
    }

    let validatedWeight, validatedHeight, validatedHead;
    try {
      validatedWeight = validateMeasurementValue(weightKg, 'weight', 'Weight');
      validatedHeight = validateMeasurementValue(heightCm, 'height', 'Height');
      validatedHead = validateMeasurementValue(headCircumferenceCm, 'headCircumference', 'Head circumference');
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError.message
      });
    }

    if (validatedWeight === null && validatedHeight === null && validatedHead === null) {
      return res.status(400).json({
        success: false,
        error: 'At least one measurement (weight, height, or head circumference) is required'
      });
    }

    const measurement = await BabyProfile.addMeasurement(
      measurementDate,
      validatedWeight,
      validatedHeight,
      validatedHead,
      notes || null
    );

    res.json({
      success: true,
      measurement
    });
  } catch (error) {
    console.error('Error adding baby measurement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add baby measurement'
    });
  }
});

router.get('/baby-measurements', async (req, res) => {
  try {
    const measurements = await BabyProfile.getMeasurements();
    res.json({
      success: true,
      measurements
    });
  } catch (error) {
    console.error('Error getting baby measurements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get baby measurements'
    });
  }
});

module.exports = router;
