import { motion } from 'framer-motion'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
}

export default function Hero({
  heading = 'AXIS SEATTLE',
  browseLabel = 'View Available Housing',
}) {
  return (
    <section className="relative w-full bg-transparent">
      <div className="container mx-auto px-4 pb-10 pt-12 sm:px-6 sm:pb-14 sm:pt-16 lg:px-8 lg:pb-16 lg:pt-20">
        <motion.div className="max-w-2xl" variants={container} initial="hidden" animate="show">
          <motion.h1 variants={item} className="font-display max-w-[12ch] text-[clamp(2.2rem,8vw,5.4rem)] font-semibold leading-[0.95] tracking-[-0.04em] text-slate-900">
            {heading}
          </motion.h1>

          <motion.div variants={item} className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' })}
              className="w-full rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(37,99,235,0.22)] transition hover:brightness-105 active:scale-[0.97] sm:w-auto sm:px-7"
            >
              {browseLabel}
            </button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
