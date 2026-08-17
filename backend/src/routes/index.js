const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/appointments', require('./appointment.routes'));
router.use('/forum', require('./forum.routes'));
router.use('/resources', require('./resource.routes'));
router.use('/journals', require('./journal.routes'));
router.use('/mood', require('./mood.routes'));
router.use('/assessments', require('./assessment.routes'));
router.use('/chat', require('./chat.routes'));
router.use('/reports', require('./report.routes'));
router.use('/feedback', require('./feedback.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/bookmarks', require('./bookmark.routes'));
router.use('/emergency', require('./emergency.routes'));
router.use('/admin/analytics', require('./analytics.routes'));
router.use('/counselor-notes', require('./counselorNote.routes'));
router.use('/volunteer-activities', require('./volunteerActivity.routes'));
router.use('/ice-servers', require('./ice.routes'));

module.exports = router;
