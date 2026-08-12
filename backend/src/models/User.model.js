const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');
const { ROLE_VALUES, ROLES } = require('../utils/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLE_VALUES, default: ROLES.STUDENT, required: true },

    avatarUrl: { type: String, default: '' },
    college: { type: String, default: '' },

    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpiry: { type: Date, select: false },

    refreshToken: { type: String, select: false },

    passwordResetToken: { type: String, select: false },
    passwordResetExpiry: { type: Date, select: false },

    isActive: { type: Boolean, default: true },
    isBanned: { type: Boolean, default: false },
    lastLogin: { type: Date },

    // Escalation & care continuity — set automatically, never by the user directly
    assignedCounselor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    riskLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    riskUpdatedAt: { type: Date, default: null },

    // Only populated/relevant when role === 'counselor'. Kept as a subdocument
    // rather than a separate collection since it's always fetched together
    // with the counselor's user record and has no independent lifecycle.
    counselorProfile: {
      photoUrl: { type: String, default: '' },
      qualification: { type: String, default: '' },
      specialization: [{ type: String, trim: true }],
      yearsOfExperience: { type: Number, default: 0, min: 0 },
      languages: [{ type: String, trim: true }],
      bio: { type: String, default: '', maxlength: 1000 },
      consultationModes: [{ type: String, enum: ['online', 'offline', 'phone'] }],
      workingDays: [{ type: String, enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }],
      workingHours: {
        start: { type: String, default: '09:00' }, // 24h "HH:MM"
        end: { type: String, default: '17:00' },
      },
      slotDurationMinutes: { type: Number, default: 30 },
      consultationFee: { type: Number, default: 0 },
      phone: { type: String, default: '' },
      officeLocation: { type: String, default: '' },
      meetingLink: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

userSchema.methods.generateAccessToken = function generateAccessToken() {
  return jwt.sign({ id: this._id, role: this.role }, env.accessTokenSecret, {
    expiresIn: env.accessTokenExpiry,
  });
};

userSchema.methods.generateRefreshToken = function generateRefreshToken() {
  return jwt.sign({ id: this._id }, env.refreshTokenSecret, {
    expiresIn: env.refreshTokenExpiry,
  });
};

userSchema.methods.generateEmailVerificationToken = function generateEmailVerificationToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.emailVerificationExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24h
  return rawToken;
};

userSchema.methods.generatePasswordResetToken = function generatePasswordResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.passwordResetExpiry = Date.now() + 60 * 60 * 1000; // 1h
  return rawToken;
};

module.exports = mongoose.model('User', userSchema);