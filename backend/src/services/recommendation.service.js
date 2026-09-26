const PHQ9Assessment = require('../models/PHQ9Assessment.model');
const GAD7Assessment = require('../models/GAD7Assessment.model');
const MoodTracking = require('../models/MoodTracking.model');
const Appointment = require('../models/Appointment.model');
const { PHQ9_SEVERITY, GAD7_SEVERITY, APPOINTMENT_STATUS } = require('../utils/constants');

/**
 * Generates personalized, prioritized recommendations for a student based on:
 * 1. Clinical assessments (PHQ-9, GAD-7)
 * 2. Recent mood tracking history
 * 3. Appointment history & upcoming consultations
 */
const getStudentRecommendations = async (userId) => {
  const [latestPHQ9, latestGAD7, recentMoods, upcomingAppt] = await Promise.all([
    PHQ9Assessment.findOne({ user: userId }).sort({ takenAt: -1 }),
    GAD7Assessment.findOne({ user: userId }).sort({ takenAt: -1 }),
    MoodTracking.find({ user: userId }).sort({ date: -1 }).limit(7),
    Appointment.findOne({
      student: userId,
      status: { $in: [APPOINTMENT_STATUS.PENDING, APPOINTMENT_STATUS.APPROVED, APPOINTMENT_STATUS.IN_SESSION] },
    }).sort({ preferredDate: 1 }),
  ]);

  const recommendations = [];

  // 1. Critical & Clinical Assessment Signals
  const hasSeverePHQ9 =
    latestPHQ9 &&
    (latestPHQ9.severity === PHQ9_SEVERITY.SEVERE ||
      latestPHQ9.severity === PHQ9_SEVERITY.MODERATELY_SEVERE ||
      (latestPHQ9.answers && latestPHQ9.answers[8] > 0));

  const hasSevereGAD7 =
    latestGAD7 &&
    (latestGAD7.severity === GAD7_SEVERITY.SEVERE || latestGAD7.severity === GAD7_SEVERITY.MODERATE);

  if (hasSeverePHQ9) {
    recommendations.push({
      type: 'professional_help',
      priority: 'urgent',
      title: 'Connect with a Campus Counselor',
      description: 'Your recent depression screening indicates elevated distress. Speaking with a counselor can provide compassionate, professional guidance.',
      action: {
        label: upcomingAppt ? 'View Appointment' : 'Book a Session',
        link: '/dashboard/student/appointments',
      },
    });
  } else if (hasSevereGAD7) {
    recommendations.push({
      type: 'breathing_exercise',
      priority: 'high',
      title: 'Managing Anxiety & Stress',
      description: 'Your responses reflect noticeable anxiety. Guided breathing exercises and grounding techniques can help restore balance.',
      action: {
        label: 'View Resources',
        link: '/dashboard/student/resources',
      },
    });
  }

  // 2. Recent Mood Signals
  const latestMood = recentMoods[0];
  const isRecentMoodLow = latestMood && (latestMood.moodLabel === 'very_sad' || latestMood.moodLabel === 'sad' || latestMood.moodScore <= 2);

  if (isRecentMoodLow) {
    recommendations.push({
      type: 'mood_support',
      priority: 'high',
      title: 'Talk to the AI Assistant',
      description: 'You logged feeling down recently. The MindMitra AI assistant is here 24/7 to listen and help you work through what is on your mind.',
      action: {
        label: 'Start Chat',
        link: '/dashboard/student/chat',
      },
    });

    recommendations.push({
      type: 'journal_prompt',
      priority: 'medium',
      title: 'Reflect in Your Private Journal',
      description: 'Putting thoughts and feelings into words can release emotional tension and help clarify your feelings.',
      action: {
        label: 'Write an Entry',
        link: '/dashboard/student/journal',
      },
    });
  }

  // 3. Assessment Reminder (if never taken or older than 14 days)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const needsAssessmentCheckin =
    !latestPHQ9 || !latestGAD7 || (latestPHQ9.takenAt < fourteenDaysAgo && latestGAD7.takenAt < fourteenDaysAgo);

  if (needsAssessmentCheckin && recommendations.length < 4) {
    recommendations.push({
      type: 'self_care',
      priority: 'medium',
      title: 'Take a Periodic Self-Check',
      description: 'Self-assessments like PHQ-9 and GAD-7 take less than 3 minutes and help track changes in your well-being over time.',
      action: {
        label: 'Take Assessment',
        link: '/dashboard/student/assessments',
      },
    });
  }

  // 4. Daily Mood Logging Reminder
  const loggedToday =
    latestMood && new Date(latestMood.date).toDateString() === new Date().toDateString();

  if (!loggedToday && recommendations.length < 4) {
    recommendations.push({
      type: 'mood_support',
      priority: 'low',
      title: "Log Today's Mood",
      description: 'A 10-second check-in helps you identify trends in your energy and emotion.',
      action: {
        label: 'Log Mood',
        link: '/dashboard/student/mood',
      },
    });
  }

  // 5. Mindfulness & Self-care default
  if (recommendations.length < 4) {
    recommendations.push({
      type: 'meditation',
      priority: 'low',
      title: 'Mindfulness & Relaxation Guides',
      description: 'Explore articles, audio clips, and exercises curated to help you de-stress and refocus.',
      action: {
        label: 'Explore Library',
        link: '/dashboard/student/resources',
      },
    });
  }

  return recommendations.slice(0, 4);
};

module.exports = { getStudentRecommendations };
