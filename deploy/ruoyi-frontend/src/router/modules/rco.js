import Layout from '@/layout'

const rcoRouter = {
  path: '/rco',
  component: Layout,
  redirect: 'noRedirect',
  name: 'RcoCenter',
  alwaysShow: true,
  meta: {
    title: '远控中心',
    icon: 'monitor',
  },
  children: [
    {
      path: 'device',
      component: () => import('@/views/rco/device/index'),
      name: 'RcoDevice',
      meta: {
        title: '设备管理',
        noCache: false,
        permissions: ['rco:client:list'],
      },
    },
    {
      path: 'media',
      component: () => import('@/views/rco/media/index'),
      name: 'RcoMedia',
      meta: {
        title: '媒体管理',
        noCache: false,
        permissions: ['rco:media:list'],
      },
    },
    {
      path: 'schedule',
      component: () => import('@/views/rco/schedule/index'),
      name: 'RcoSchedule',
      meta: {
        title: '计划任务',
        noCache: false,
        permissions: ['rco:schedule:list'],
      },
    },
    {
      path: 'audit',
      component: () => import('@/views/rco/audit/index'),
      name: 'RcoAudit',
      meta: {
        title: '命令审计',
        noCache: false,
        permissions: ['rco:audit:list'],
      },
    },
    {
      path: 'redis',
      component: () => import('@/views/rco/redis/index'),
      name: 'RcoRedis',
      meta: {
        title: 'Redis 监控',
        noCache: false,
        permissions: ['rco:redis:monitor'],
      },
    },
  ],
}

export default rcoRouter
